const configManager = require('../utils/configManager')
const { fetchFirebase } = require('../utils/firebaseConfig')
const { obterVinculo } = require('../auto/vinculo')
const fluxoCompra = require('../auto/fluxoCompra')
const notificador = require('../auto/notificadorCompra')
const assinaturaOficial = require('./assinaturaOficial')
const comprovantesOficiais = require('./comprovantesOficiais')
const pagamentoAuto = require('./pagamentoAuto')
const {
    reciboJaUsado,
    iniciarProcessamentoRecibo,
    finalizarProcessamentoRecibo,
    desmarcarReciboUsado
} = require('./recibos')

const INTERVALO_MS = 15 * 1000
const JANELA_MAXIMA_MS = 60 * 60 * 1000
const TOLERANCIA_ACTIVACAO_MS = 2 * 60 * 1000
const LIMITE_QUERY = 200

let intervalo = null
let executando = false

function grupoIdDaChave(chave) {
    const valor = String(chave || '')
    if (valor.endsWith('@g.us')) return valor
    if (valor.endsWith('@g___dot___us')) return valor.replace('@g___dot___us', '@g.us')
    if (valor.endsWith('@g_us')) return valor.replace('@g_us', '@g.us')
    return ''
}

function agoraMocambique() {
    const agora = new Date()
    const utc = agora.getTime() + (agora.getTimezoneOffset() * 60000)
    return utc + (2 * 60 * 60000)
}

function grupoAutorizado(entry) {
    if (!entry?.authorized) return false
    if (!entry.expiraEm) return true
    return agoraMocambique() < Number(entry.expiraEm)
}

function provedorEmola(provider) {
    const texto = String(provider || '').toLowerCase()
    return texto.includes('emola') || texto.includes('e-mola') || texto.includes('movitel')
}

function codigoCentral(valor) {
    return String(valor || '').trim().toUpperCase()
}

function gruposActivos() {
    const groups = configManager.loadGroupConfig() || {}
    const grupos = []
    const centrais = new Set()

    for (const [chave, entry] of Object.entries(groups)) {
        if (!entry?.pagamentoAuto?.ativo) continue
        if (!grupoAutorizado(entry)) continue

        const grupoId = grupoIdDaChave(chave)
        if (!grupoId) continue

        const vinculo = obterVinculo(grupoId)
        if (!vinculo.autoAtivo || !vinculo.centralCode) continue

        const central = codigoCentral(vinculo.centralCode)
        if (!central || centrais.has(central)) continue
        centrais.add(central)

        grupos.push({
            grupoId,
            entry,
            central,
            ativadoEm: Number(entry.pagamentoAuto.ativadoEm) || Number(entry.pagamentoAuto.atualizadoEm) || Date.now()
        })
    }

    return grupos
}

async function buscarRegistros(central, ativadoEm) {
    const desde = Math.max(Number(ativadoEm) - TOLERANCIA_ACTIVACAO_MS, Date.now() - JANELA_MAXIMA_MS)
    const caminhoQuery = `device_pairings/${encodeURIComponent(central)}/comprovantes_oficiais?orderBy=%22timestamp%22&startAt=${desde}&limitToLast=${LIMITE_QUERY}`
    const caminhoCompleto = `device_pairings/${encodeURIComponent(central)}/comprovantes_oficiais`

    let dados = null
    try {
        dados = await fetchFirebase(caminhoQuery)
    } catch {}

    if (!dados || typeof dados !== 'object' || dados.error) {
        try {
            dados = await fetchFirebase(caminhoCompleto)
        } catch {
            dados = null
        }
    }

    if (!dados || typeof dados !== 'object' || dados.error) return []
    return Object.values(dados)
        .filter(registro => registro && typeof registro === 'object')
        .sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0))
}

function estadoPermiteProcessar(estado) {
    if (!estado) return true
    if (estado.status === pagamentoAuto.STATUS.AGUARDANDO_APP) return true
    return false
}

async function guardarAlerta(sock, grupo, registro, motivo, extras = {}) {
    const txId = pagamentoAuto.normalizarCodigo(registro.tx_id)
    const status = motivo === 'app_antigo' ? pagamentoAuto.STATUS.AGUARDANDO_APP : pagamentoAuto.STATUS.AGUARDANDO_ADMIN
    pagamentoAuto.salvarPagamento(grupo.central, txId, {
        status,
        motivo,
        provider: registro.provider || '',
        valor: Number(registro.amount_mt) || 0,
        pagador: extras.pagador || null,
        pacote: extras.pacote || null
    })
    await notificador.enviarAlertaPagamentoAuto(sock, grupo.grupoId, {
        motivo,
        oficial: registro,
        conteudo: extras.conteudo,
        pacotes: extras.pacotes,
        pagador: extras.pagador
    })
}

async function processarRegistro(sock, grupo, registro) {
    if (!provedorEmola(registro.provider)) return

    const status = String(registro.status || '').trim().toUpperCase()
    if (status !== 'DISPONIVEL') return

    const txId = pagamentoAuto.normalizarCodigo(registro.tx_id)
    if (!txId) {
        if (!pagamentoAuto.buscarPagamento(grupo.central, '')) {
            await guardarAlerta(sock, grupo, registro, 'sem_transacao')
        }
        return
    }

    const timestamp = Number(registro.timestamp) || 0
    if (!timestamp) return
    if (timestamp < grupo.ativadoEm - TOLERANCIA_ACTIVACAO_MS) return
    if (timestamp > Date.now() + 5 * 60 * 1000) return
    if (Date.now() - timestamp > JANELA_MAXIMA_MS) return

    const estado = pagamentoAuto.buscarPagamento(grupo.central, txId)
    if (estado?.status === pagamentoAuto.STATUS.PROCESSANDO) {
        if (Date.now() - Number(estado.atualizadoEm || 0) > 10 * 60 * 1000) {
            await guardarAlerta(sock, grupo, registro, 'erro_compra', { pagador: estado.pagador })
        }
        return
    }
    if (!estadoPermiteProcessar(estado)) return

    if (reciboJaUsado(txId, 'emola')) {
        pagamentoAuto.salvarPagamento(grupo.central, txId, {
            status: pagamentoAuto.STATUS.CONCLUIDO,
            motivo: 'usado'
        })
        return
    }

    const centralRegistro = codigoCentral(registro.central_code)
    if (!centralRegistro || centralRegistro !== grupo.central) {
        await guardarAlerta(sock, grupo, registro, 'central_divergente')
        return
    }

    if (!String(registro.signature_v2 || '').trim()) {
        if (estado?.status === pagamentoAuto.STATUS.AGUARDANDO_APP) return
        const assinaturaV1 = assinaturaOficial.assinaturaValida(registro)
        await guardarAlerta(sock, grupo, registro, assinaturaV1 ? 'app_antigo' : 'assinatura_invalida')
        return
    }

    if (!assinaturaOficial.assinaturaV2Valida(registro)) {
        await guardarAlerta(sock, grupo, registro, 'assinatura_invalida')
        return
    }

    const destino = assinaturaOficial.normalizarTelefone(registro.target_phone)
    if (!/^8[45]\d{7}$/.test(destino)) {
        await guardarAlerta(sock, grupo, registro, 'destino_ausente')
        return
    }

    const conteudo = pagamentoAuto.extrairNumeroConteudo(registro.raw_text)
    if (!conteudo.ok) {
        await guardarAlerta(sock, grupo, registro, conteudo.motivo, { conteudo })
        return
    }
    if (conteudo.numero !== destino) {
        await guardarAlerta(sock, grupo, registro, 'destino_divergente', { conteudo })
        return
    }

    const valor = Number(registro.amount_mt) || 0
    const pacoteResultado = pagamentoAuto.resolverPacote(valor, grupo.grupoId)
    if (!pacoteResultado.ok) {
        await guardarAlerta(sock, grupo, registro, pacoteResultado.motivo, {
            pacotes: pacoteResultado.pacotes,
            conteudo
        })
        return
    }

    if (!iniciarProcessamentoRecibo(txId, 'emola')) {
        if (reciboJaUsado(txId, 'emola')) {
            pagamentoAuto.salvarPagamento(grupo.central, txId, {
                status: pagamentoAuto.STATUS.CONCLUIDO,
                motivo: 'usado'
            })
        }
        return
    }

    const pagador = pagamentoAuto.extrairPagador(registro.raw_text, registro)
    const pacote = pacoteResultado.pacote
    const sender = pagador.telefone ? `${pagador.telefone}@s.whatsapp.net` : grupo.grupoId
    const nome = pagador.nome || (pagador.telefone ? `Pagador ${pagador.telefone}` : 'Pagador e-Mola')

    pagamentoAuto.salvarPagamento(grupo.central, txId, {
        status: pagamentoAuto.STATUS.PROCESSANDO,
        provider: registro.provider || 'e-Mola',
        valor,
        pagador,
        conteudo,
        pacote: {
            mb: Number(pacote.mb) || 0,
            gb: pacote.gb || '',
            tipo: pacote.tipo || ''
        }
    })

    try {
        const resultado = await fluxoCompra.criarCompra({
            sock,
            from: grupo.grupoId,
            sender,
            nome,
            itens: [{
                numero: destino,
                mb: Number(pacote.mb) || 0,
                valor,
                displayPacote: pacote.gb || ''
            }],
            valorTotal: valor,
            tipoPacote: pacote.tipo || '',
            codigo: txId,
            ussdMethod: '*162#',
            centralCode: grupo.central,
            origem: 'emola-pagamento-auto',
            msgPagamentoKey: null,
            pagamento: {
                sistema: 'e-Mola',
                valor,
                pagadorNome: pagador.nome || '',
                pagadorTelefone: pagador.telefone || '',
                targetPhone: destino,
                txId,
                recebidoEm: timestamp,
                centralCode: grupo.central,
                conteudo: conteudo.numero
            }
        })

        if (!resultado.ok) {
            desmarcarReciboUsado(txId)
            pagamentoAuto.salvarPagamento(grupo.central, txId, {
                status: pagamentoAuto.STATUS.ERRO,
                motivo: resultado.motivo || 'erro_compra',
                erro: resultado.erro || '',
                pagador,
                pacote
            })
            await notificador.enviarAlertaPagamentoAuto(sock, grupo.grupoId, {
                motivo: 'erro_compra',
                oficial: registro,
                conteudo,
                pagador
            })
            return
        }

        try {
            await comprovantesOficiais.marcarUtilizado(txId, grupo.central, 'pagamento-auto')
        } catch (err) {
            console.error('[PAGAMENTO-AUTO] Falha ao marcar comprovante oficial:', err.message)
        }

        pagamentoAuto.salvarPagamento(grupo.central, txId, {
            status: resultado.aguardando
                ? pagamentoAuto.STATUS.AGUARDANDO_ENTREGA
                : pagamentoAuto.STATUS.CONCLUIDO,
            motivo: '',
            compraId: resultado.compra?.id || '',
            pedidoNumero: resultado.compra?.pedidoNumero || '',
            pagador,
            pacote: {
                mb: Number(pacote.mb) || 0,
                gb: pacote.gb || '',
                tipo: pacote.tipo || ''
            }
        })
    } catch (err) {
        desmarcarReciboUsado(txId)
        pagamentoAuto.salvarPagamento(grupo.central, txId, {
            status: pagamentoAuto.STATUS.ERRO,
            motivo: 'erro_compra',
            erro: err.message,
            pagador,
            pacote
        })
        await notificador.enviarAlertaPagamentoAuto(sock, grupo.grupoId, {
            motivo: 'erro_compra',
            oficial: registro,
            conteudo,
            pagador
        })
    } finally {
        finalizarProcessamentoRecibo(txId)
    }
}

async function processarGrupo(sock, grupo) {
    const registros = await buscarRegistros(grupo.central, grupo.ativadoEm)
    for (const registro of registros) {
        try {
            await processarRegistro(sock, grupo, registro)
        } catch (err) {
            console.error(`[PAGAMENTO-AUTO] Erro ao processar ${registro?.tx_id || 'registro'}:`, err.message)
        }
    }
}

async function ciclo(sock) {
    const grupos = gruposActivos()
    for (const grupo of grupos) {
        try {
            await processarGrupo(sock, grupo)
        } catch (err) {
            console.error(`[PAGAMENTO-AUTO] Erro no grupo ${grupo.grupoId}:`, err.message)
        }
    }
}

function iniciarMonitorPagamentoAuto(sock) {
    if (intervalo) return
    try { pagamentoAuto.limparAntigos(30) } catch {}
    const tick = async () => {
        if (executando) return
        const socket = typeof sock === 'function' ? sock() : sock
        if (!socket) return
        executando = true
        try {
            await ciclo(socket)
        } catch (err) {
            console.error('[PAGAMENTO-AUTO] Erro no ciclo:', err.message)
        } finally {
            executando = false
        }
    }
    setTimeout(tick, 5000)
    intervalo = setInterval(tick, INTERVALO_MS)
    console.log('[PAGAMENTO-AUTO] Monitor iniciado (15s).')
}

function pararMonitorPagamentoAuto() {
    if (intervalo) clearInterval(intervalo)
    intervalo = null
    executando = false
}

module.exports = {
    INTERVALO_MS,
    iniciarMonitorPagamentoAuto,
    pararMonitorPagamentoAuto,
    gruposActivos,
    buscarRegistros,
    processarRegistro
}

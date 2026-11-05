const fs = require('fs')
const path = require('path')
const fila = require('./fila')
const { obterCapacidadeSims, distribuirPartes } = require('./simSelector')
const { planejarPartes } = require('./planejadorPartes')
const { comLock } = require('./enfileiramentoLock')
const notificador = require('./notificadorCompra')
const tracker = require('../vendas/tracker')
const { parseToMB } = require('../vendas/tracker')
const { marcarReciboUsado, finalizarProcessamentoRecibo } = require('../vendas/recibos')
const { salvarEntregaPendente } = require('../bot/entregasPendentes')

const ARQUIVO = path.join(__dirname, '../../data/comprasAuto.json')
const MAX_PARTES_COMPRA = 20
const TIMEOUT_PENDENTE_MS = 60 * 60 * 1000

const STATUS_ENCERRADOS = ['CONCLUIDA', 'FALHA_PARCIAL', 'CANCELADA', 'ERRO']
const STATUS_ESPERA = ['NOVA', 'AGUARDANDO_CAPACIDADE', 'AGUARDANDO_TELEMETRIA', 'ENFILEIRANDO']

function carregarEstado() {
    try {
        const bruto = fs.readFileSync(ARQUIVO, 'utf8')
        const dados = JSON.parse(bruto)
        if (dados && typeof dados === 'object' && dados.compras && typeof dados.compras === 'object') return dados
    } catch {}
    return { compras: {} }
}

function salvarEstado(estado) {
    try {
        fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true })
        const tmp = ARQUIVO + '.tmp'
        fs.writeFileSync(tmp, JSON.stringify(estado, null, 2))
        fs.renameSync(tmp, ARQUIVO)
        return true
    } catch (err) {
        console.error('[COMPRA-AUTO] Erro ao salvar estado:', err.message)
        return false
    }
}

function listarCompras() {
    return Object.values(carregarEstado().compras)
}

function buscarCompra(id) {
    if (!id) return null
    const estado = carregarEstado()
    return estado.compras[id] || null
}

function buscarCompraPorPedido(numero) {
    const alvo = String(numero || '').replace(/[^\d]/g, '')
    if (!alvo) return null
    return listarCompras().find(c => String(c.pedidoNumero) === alvo) || null
}

function salvarCompra(compra) {
    const estado = carregarEstado()
    estado.compras[compra.id] = compra
    salvarEstado(estado)
    return compra
}

function agregarItens(itens) {
    const mapa = new Map()
    for (const item of Array.isArray(itens) ? itens : []) {
        const numero = fila.normalizarTelefone(item.numero)
        if (!numero) return { ok: false, erro: `Número inválido: ${item.numero || '(vazio)'}` }

        const mb = Math.round(Number(item.mb) || parseToMB(item.displayPacote || item.pacote || ''))
        if (mb <= 0) return { ok: false, erro: `Pacote inválido para ${numero}.` }

        const atual = mapa.get(numero) || {
            numero,
            mbTotal: 0,
            valorTotal: 0,
            displayPacote: item.displayPacote || ''
        }
        atual.mbTotal += mb
        atual.valorTotal += Number(item.valor) || 0
        if (!atual.displayPacote && item.displayPacote) atual.displayPacote = item.displayPacote
        mapa.set(numero, atual)
    }

    const lista = [...mapa.values()]
    if (lista.length === 0) return { ok: false, erro: 'Nenhum destino válido foi informado.' }
    return { ok: true, itens: lista }
}

function montarPartes(compra) {
    const partes = []
    for (const item of compra.itens) {
        const lista = planejarPartes(item.mbTotal)
        const valorPorParte = lista.length > 0 ? Math.floor((item.valorTotal || 0) / lista.length) : 0
        let acumulado = 0
        lista.forEach((mb, indice) => {
            const ultima = indice === lista.length - 1
            const valor = ultima
                ? Math.max(0, (item.valorTotal || 0) - acumulado)
                : valorPorParte
            acumulado += valor
            partes.push({
                id: `PED-${compra.pedidoNumero}-${partes.length + 1}`,
                numero: item.numero,
                mb,
                mbEnvio: mb,
                valor,
                indiceItem: indice + 1,
                totalItem: lista.length,
                parteGlobal: partes.length + 1,
                status: 'PENDENTE',
                pedidoId: null
            })
        })
    }
    return partes
}

async function registrarPagamentoConfirmado(compra) {
    if (compra.vendaRegistrada) return
    try {
        tracker.registrarVenda(
            compra.grupoId,
            compra.clienteId,
            compra.clienteNome || compra.clienteId,
            `${compra.totalMb}MB`,
            false,
            { chaveIdempotencia: `COMPRA:${compra.id}`, forceSave: true }
        )
        compra.vendaRegistrada = true
    } catch (err) {
        console.error('[COMPRA-AUTO] Falha ao registar venda:', err.message)
    }

    if (compra.codigo && !/^manual$/i.test(String(compra.codigo).trim())) {
        try {
            marcarReciboUsado(compra.codigo, {
                valor: compra.valorTotal,
                destino: compra.itens.map(i => i.numero).join(','),
                por: compra.origem || 'compra-auto'
            })
        } catch (err) {
            console.error('[COMPRA-AUTO] Falha ao marcar recibo:', err.message)
        }
    }
    finalizarProcessamentoRecibo(compra.codigo)
    salvarCompra(compra)
}

function salvarEntregasCompra(compra) {
    if (compra.entregasSalvas) return
    for (const parte of compra.partes || []) {
        const dados = {
            compraId: compra.id,
            parteId: parte.id,
            parte: parte.parteGlobal,
            totalPartes: compra.totalPartes,
            vendaRegistrada: true,
            clienteId: compra.clienteId,
            clienteNome: compra.clienteNome,
            numero: parte.numero,
            pacote: parte.mb >= 1024 ? `${parte.mb / 1024}GB` : `${parte.mb}MB`,
            pacoteMb: parte.mb,
            pacoteBaseMb: parte.mb,
            bonusMb: 0,
            valor: parte.valor,
            codigo: compra.codigo,
            grupoOrigem: compra.grupoId,
            timestamp: Date.now()
        }
        salvarEntregaPendente(parte.numero, dados)
        if (!parte.numero.startsWith('258')) salvarEntregaPendente('258' + parte.numero, dados)
        if (parte.numero.startsWith('258')) salvarEntregaPendente(parte.numero.substring(3), dados)
        if (compra.clienteId) salvarEntregaPendente(compra.clienteId, dados)
        if (compra.codigo) salvarEntregaPendente(compra.codigo, dados)
    }
    compra.entregasSalvas = true
    salvarCompra(compra)
}

function partesFinais(compra) {
    return (compra.partes || []).every(p => ['SUCESSO', 'FALHA', 'CANCELADO', 'EXPIRADO', 'DESAPARECIDO'].includes(p.status))
}

function contarSucessos(compra) {
    return (compra.partes || []).filter(p => p.status === 'SUCESSO').length
}

async function finalizarSePossivel(sock, compra) {
    const total = (compra.partes || []).length
    const sucessos = contarSucessos(compra)
    compra.partesEnviadas = sucessos

    if (total > 0 && sucessos === total) {
        if (!compra.notificacoes?.completa) {
            compra.status = 'CONCLUIDA'
            compra.notificacoes = compra.notificacoes || {}
            compra.notificacoes.completa = true
            salvarCompra(compra)
            await notificador.enviarTransferenciaCompleta(sock, compra)
            await new Promise(resolve => setTimeout(resolve, 300))
            let stats = null
            try {
                stats = tracker.getVendasPorPeriodo(compra.grupoId, compra.clienteId)
            } catch {}
            await notificador.enviarCompraConcluida(sock, compra, stats)
            return
        }
        compra.status = 'CONCLUIDA'
        salvarCompra(compra)
        return
    }

    if (partesFinais(compra)) {
        compra.status = 'FALHA_PARCIAL'
        salvarCompra(compra)
        if (!compra.notificacoes?.parcial) {
            compra.notificacoes = compra.notificacoes || {}
            compra.notificacoes.parcial = true
            salvarCompra(compra)
            await notificador.enviarCompraParcial(sock, compra)
        }
    } else {
        compra.status = 'EM_ENTREGA'
        salvarCompra(compra)
    }
}

async function enfileirarCompraInterno(sock, compra) {
    if (!compra.vendaRegistrada) await registrarPagamentoConfirmado(compra)
    if (STATUS_ENCERRADOS.includes(compra.status) || compra.status === 'EM_ENTREGA') {
        return { ok: true, compra }
    }

    if (!Array.isArray(compra.partes) || compra.partes.length === 0) {
        compra.partes = montarPartes(compra)
        compra.totalPartes = compra.partes.length

        if (compra.totalPartes <= 0) {
            compra.status = 'ERRO'
            compra.ultimoErro = 'Nenhuma parte válida.'
            salvarCompra(compra)
            return { ok: false, motivo: 'sem-partes', erro: compra.ultimoErro }
        }
        if (compra.totalPartes > MAX_PARTES_COMPRA) {
            compra.status = 'ERRO'
            compra.ultimoErro = `Limite de ${MAX_PARTES_COMPRA} partes por compra excedido.`
            salvarCompra(compra)
            return { ok: false, motivo: 'limite-partes', erro: compra.ultimoErro }
        }
    }

    if (!compra.plano) {
        const capacidade = await obterCapacidadeSims(compra.centralCode)
        if (!capacidade.ok) {
            compra.status = capacidade.motivo === 'sem-telemetria' ? 'AGUARDANDO_TELEMETRIA' : 'AGUARDANDO_CAPACIDADE'
            compra.ultimoErro = capacidade.erro
            salvarCompra(compra)
            if (!compra.notificacoes?.aguardando) {
                compra.notificacoes = compra.notificacoes || {}
                compra.notificacoes.aguardando = true
                salvarCompra(compra)
                await notificador.enviarAguardando(sock, compra, capacidade.erro)
            }
            return { ok: true, aguardando: true, compra }
        }

        const distribuicao = distribuirPartes(compra.partes.map(p => p.mb), capacidade)
        if (!distribuicao.ok) {
            compra.status = distribuicao.motivo === 'sem-telemetria' ? 'AGUARDANDO_TELEMETRIA' : 'AGUARDANDO_CAPACIDADE'
            compra.ultimoErro = distribuicao.erro
            salvarCompra(compra)
            if (!compra.notificacoes?.aguardando) {
                compra.notificacoes = compra.notificacoes || {}
                compra.notificacoes.aguardando = true
                salvarCompra(compra)
                await notificador.enviarAguardando(sock, compra, distribuicao.erro)
            }
            return { ok: true, aguardando: true, compra }
        }

        compra.partes.forEach((parte, indice) => {
            const atribuicao = distribuicao.atribuicoes[indice]
            parte.dispositivoId = atribuicao.dispositivoId || null
            parte.slot = atribuicao.slot
            parte.simNome = atribuicao.simNome
            parte.mbEnvio = atribuicao.mbEnvio
            parte.ajuste10 = atribuicao.ajuste10
        })
        compra.status = 'ENFILEIRANDO'
        compra.plano = true
        salvarCompra(compra)
    }

    if (compra.status === 'NOVA' || compra.status === 'AGUARDANDO_CAPACIDADE' || compra.status === 'AGUARDANDO_TELEMETRIA') {
        compra.status = 'ENFILEIRANDO'
        salvarCompra(compra)
    }

    for (const parte of compra.partes) {
        if (parte.pedidoId) continue

        const resultado = await fila.enfileirar({
            id: parte.id,
            numeroPedido: compra.pedidoNumero,
            centralCode: compra.centralCode,
            clientePhone: parte.numero,
            megasAmount: parte.mbEnvio,
            mbExibicao: parte.mb,
            valorPago: parte.valor,
            tipoPacote: compra.tipoPacote || '',
            pacoteBaseMb: parte.mb,
            displayPacote: parte.mb >= 1024 ? `${parte.mb / 1024}GB` : `${parte.mb}MB`,
            ussdMethod: compra.ussdMethod || '*162#',
            grupoId: compra.grupoId,
            solicitadoPor: compra.clienteId,
            referenciaRecibo: compra.codigo,
            clienteNome: compra.clienteNome,
            bonusMb: 0,
            targetDeviceId: parte.dispositivoId || '',
            targetSimSlot: parte.slot,
            compraId: compra.id,
            parte: parte.parteGlobal,
            totalPartes: compra.totalPartes,
            silenciarCard: true,
            perfil: 'COMPRA',
            registrarNoMonitor: false,
            timeoutPendenteMs: TIMEOUT_PENDENTE_MS
        })

        if (!resultado.ok) {
            compra.ultimoErro = resultado.motivo
            salvarCompra(compra)
            return { ok: false, motivo: resultado.motivo, erro: resultado.motivo, compra }
        }

        parte.pedidoId = resultado.pedido.id
        salvarCompra(compra)
    }

    compra.status = 'EM_ENTREGA'
    compra.ultimoErro = ''
    compra.notificacoes = compra.notificacoes || {}
    salvarCompra(compra)
    salvarEntregasCompra(compra)

    if (!compra.notificacoes.pagamento) {
        const enviou = await notificador.enviarPagamentoConfirmado(sock, compra)
        if (enviou) {
            compra.notificacoes.pagamento = true
            salvarCompra(compra)
        }
    }

    return { ok: true, compra }
}

function tentarEnfileirarCompra(sock, compra) {
    return comLock(() => enfileirarCompraInterno(sock, compra))
}

async function criarCompra({ sock, from, sender, nome, itens, valorTotal, tipoPacote, codigo, ussdMethod, centralCode, origem }) {
    if (!from || !sender) return { ok: false, motivo: 'sem-cliente', erro: 'Compra sem cliente identificado.' }
    if (!centralCode) return { ok: false, motivo: 'sem-servidor', erro: 'Grupo sem servidor vinculado.' }

    const agregados = agregarItens(itens)
    if (!agregados.ok) return { ok: false, motivo: 'itens-invalidos', erro: agregados.erro }

    const totalMb = agregados.itens.reduce((soma, item) => soma + item.mbTotal, 0)
    if (totalMb <= 0) return { ok: false, motivo: 'itens-invalidos', erro: 'Pacote total inválido.' }

    const totalPartesProjetadas = agregados.itens.reduce((soma, item) => soma + planejarPartes(item.mbTotal).length, 0)
    if (totalPartesProjetadas > MAX_PARTES_COMPRA) {
        return {
            ok: false,
            motivo: 'limite-partes',
            erro: `Esta compra precisa de ${totalPartesProjetadas} partes e o limite é ${MAX_PARTES_COMPRA}.`
        }
    }

    const pedidoNumero = await fila.obterProximoNumeroPedido(centralCode)
    const compra = {
        id: `COMP-${pedidoNumero}`,
        pedidoNumero,
        grupoId: from,
        clienteId: sender,
        clienteNome: nome || String(sender).split('@')[0],
        codigo: codigo || '',
        valorTotal: Number(valorTotal) || agregados.itens.reduce((soma, item) => soma + item.valorTotal, 0),
        totalMb,
        tipoPacote: tipoPacote || '',
        ussdMethod: ussdMethod || '*162#',
        centralCode: String(centralCode).trim().toUpperCase(),
        origem: origem || 'compra',
        status: 'NOVA',
        itens: agregados.itens,
        partes: [],
        totalPartes: 0,
        partesEnviadas: 0,
        criadoEm: Date.now(),
        atualizadoEm: Date.now(),
        notificacoes: {}
    }

    salvarCompra(compra)
    await registrarPagamentoConfirmado(compra)

    return tentarEnfileirarCompra(sock, compra)
}

function buscarParte(compra, pedido) {
    if (!compra || !Array.isArray(compra.partes)) return null
    return compra.partes.find(p => p.pedidoId && p.pedidoId === pedido?.id) ||
        compra.partes.find(p => String(p.id) === String(pedido?.id)) ||
        null
}

async function processarStatusPedidoInterno(sock, pedido, status, remoto) {
    if (!pedido || !pedido.compraId) return false
    const compra = buscarCompra(pedido.compraId)
    if (!compra) return false

    const parte = buscarParte(compra, pedido)
    if (!parte) return false

    const statusFinal = String(status || pedido.status || '').toUpperCase()
    const sucesso = ['SUCESSO', 'CONCLUIDO'].includes(statusFinal)
    const falha = ['FALHA', 'CANCELADO', 'EXPIRADO', 'DESAPARECIDO'].includes(statusFinal)

    if (sucesso) {
        if (parte.status !== 'SUCESSO') {
            parte.status = 'SUCESSO'
            parte.concluidoEm = Date.now()
            salvarCompra(compra)

            const deveEnviarParte = parte.indiceItem < parte.totalItem &&
                !compra.notificacoes?.[`parte:${parte.id}`]
            if (deveEnviarParte) {
                compra.notificacoes = compra.notificacoes || {}
                compra.notificacoes[`parte:${parte.id}`] = true
                compra.partesEnviadas = contarSucessos(compra)
                salvarCompra(compra)
                await notificador.enviarParte(sock, compra, parte)
            }
        }
        await finalizarSePossivel(sock, compra)
        return true
    }

    if (falha && parte.status !== 'FALHA' && parte.status !== 'SUCESSO') {
        parte.status = 'FALHA'
        parte.erro = remoto?.motivoErro || remoto?.erro || statusFinal
        salvarCompra(compra)

        const chave = `falha:${parte.id}`
        if (!compra.notificacoes?.[chave]) {
            compra.notificacoes = compra.notificacoes || {}
            compra.notificacoes[chave] = true
            salvarCompra(compra)
            await notificador.enviarFalha(sock, compra, parte, parte.erro)
        }
        await finalizarSePossivel(sock, compra)
        return true
    }

    return false
}

async function confirmarPartePorSmsInterno(sock, pendente, mbEnv) {
    if (!pendente || !pendente.compraId) return false
    const compra = buscarCompra(pendente.compraId)
    if (!compra) return false

    const numero = fila.normalizarTelefone(pendente.numero)
    const pendentes = (compra.partes || []).filter(p => p.numero === numero && p.status !== 'SUCESSO')
    if (pendentes.length === 0) return false

    const mb = Math.round(Number(mbEnv) || Number(pendente.pacoteMb) || 0)
    let alvos = []

    const combinando = pendentes.find(p => mb > 0 && Math.abs(p.mb - mb) <= 3)
    if (combinando) {
        alvos = [combinando]
    } else if (mb > 0) {
        const soma = pendentes.reduce((total, p) => total + p.mb, 0)
        const itemCompra = (compra.itens || []).find(item => item.numero === numero)
        if (Math.abs(soma - mb) <= 5 || (itemCompra && Math.abs(itemCompra.mbTotal - mb) <= 5)) {
            alvos = pendentes.slice()
        }
    }

    if (alvos.length === 0 && pendente.parteId) {
        const parte = pendentes.find(p => p.id === pendente.parteId)
        if (parte) alvos = [parte]
    }
    if (alvos.length === 0) alvos = [pendentes[0]]

    for (const parte of alvos) {
        if (parte.status === 'SUCESSO') continue
        parte.status = 'SUCESSO'
        parte.concluidoEm = Date.now()
        parte.confirmadoPorSms = true
        if (parte.pedidoId) {
            fila.atualizarPedido(parte.pedidoId, { status: 'SUCESSO', statusRemoto: 'SUCESSO' })
        }

        const deveEnviarParte = parte.indiceItem < parte.totalItem &&
            !compra.notificacoes?.[`parte:${parte.id}`]
        if (deveEnviarParte) {
            compra.notificacoes = compra.notificacoes || {}
            compra.notificacoes[`parte:${parte.id}`] = true
            compra.partesEnviadas = contarSucessos(compra)
            salvarCompra(compra)
            await notificador.enviarParte(sock, compra, parte)
        }
    }

    compra.partesEnviadas = contarSucessos(compra)
    salvarCompra(compra)
    await finalizarSePossivel(sock, compra)
    return true
}

function processarStatusPedido(sock, pedido, status, remoto) {
    return comLock(() => processarStatusPedidoInterno(sock, pedido, status, remoto))
}

function confirmarPartePorSms(sock, pendente, mbEnv) {
    return comLock(() => confirmarPartePorSmsInterno(sock, pendente, mbEnv))
}

function atualizarParteReatribuida(pedidoId, dados) {
    const pedido = fila.buscarPorId(pedidoId)
    if (!pedido || !pedido.compraId) return false
    const compra = buscarCompra(pedido.compraId)
    if (!compra) return false
    const parte = buscarParte(compra, pedido)
    if (!parte) return false

    if (dados.dispositivoId) parte.dispositivoId = dados.dispositivoId
    if (Number.isInteger(dados.slot)) parte.slot = dados.slot
    if (dados.simNome) parte.simNome = dados.simNome
    if (Number.isFinite(Number(dados.mbEnvio))) parte.mbEnvio = Number(dados.mbEnvio)
    if (Number.isFinite(Number(dados.ajuste10))) parte.ajuste10 = Number(dados.ajuste10)
    parte.reatribuidoEm = Date.now()
    salvarCompra(compra)
    return true
}

function temPartesPendentes(compraId, numero) {
    const compra = buscarCompra(compraId)
    if (!compra) return false
    const alvo = fila.normalizarTelefone(numero)
    return (compra.partes || []).some(p => p.numero === alvo && p.status !== 'SUCESSO')
}

async function processarComprasEmEspera(sock) {
    const compras = listarCompras().filter(c => STATUS_ESPERA.includes(c.status))
    for (const compra of compras) {
        try {
            await tentarEnfileirarCompra(sock, compra)
        } catch (err) {
            console.error(`[COMPRA-AUTO] Falha ao reprocessar ${compra.id}:`, err.message)
        }
    }
    return compras.length
}

module.exports = {
    STATUS_ENCERRADOS,
    STATUS_ESPERA,
    MAX_PARTES_COMPRA,
    carregarEstado,
    listarCompras,
    buscarCompra,
    buscarCompraPorPedido,
    criarCompra,
    processarStatusPedido,
    confirmarPartePorSms,
    atualizarParteReatribuida,
    temPartesPendentes,
    processarComprasEmEspera,
    tentarEnfileirarCompra,
    montarPartes,
    agregarItens
}

const fila = require('./fila')
const fluxoCompra = require('./fluxoCompra')
const notificador = require('./notificadorCompra')
const envioMassivo = require('./envioMassivo')
const reatribuidor = require('./reatribuidor')
const { fetchFirebase, patchFirebase } = require('../utils/firebaseConfig')
const { formatarPacoteComBonus } = require('../vendas/primeiroBonus')
const { registrarVenda, criarChaveVenda } = require('../vendas/tracker')

const INTERVALO_MS = 8000
const TIMEOUT_PENDENTE_MS = 10 * 60 * 1000
const DESAPARECIDO_MS = 90 * 1000
const LIMPEZA_IDADE_MS = 7 * 24 * 60 * 60 * 1000
const JANELA_CORRECAO_MS = 15 * 60 * 1000
const STATUS_FINAIS = ['SUCESSO', 'CONCLUIDO', 'FALHA', 'CANCELADO', 'EXPIRADO', 'DESAPARECIDO']

let timer = null
let rodando = false
let obterSock = null
let ultimaTentativaEspera = 0
let processandoEspera = false
let preparando = false

// Bug conhecido da Vodacom: "minimo de 0 MB" aparece como erro, mas a transferencia e efetivada.
function isFalsoErroMinimoZero(remoto) {
    const txt = String(remoto?.motivoErro || remoto?.erro || remoto?.ussdResponseText || '').toLowerCase()
    if (!txt.includes('minimo de 0') && !txt.includes('mínimo de 0')) return false
    return !(txt.includes('saldo actual') || txt.includes('saldo atual') ||
        txt.includes('sem megas') || txt.includes('insuficiente'))
}

// O teclado do Android entra às vezes na resposta capturada pelo app (teclas, uma por linha),
// tal como textos da própria interface da app.
function limparTextoResposta(txt) {
    const lixoApp = [
        'gestão de celulares', 'gestao de celulares', 'ver e alterar megas',
        'diagnóstico de nuvem', 'diagnostico de nuvem', 'testar conexão', 'testar conexao',
        'console ussd', 'fila de vendas', 'status dos chips', 'medindo latência', 'medindo latencia',
        'gestão de sims', 'gestao de sims'
    ]
    const linhas = String(txt || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const ignoradas = new Set(['?123', 'abc', '123', 'pt • en', 'pt · en', 'pt en', 'shift', 'enter', 'space', ',', '.', '•', 'falha de rede'])
    const teclas = linhas.filter(l => l.length === 1).length
    const boas = linhas.filter(l => {
        const low = l.toLowerCase()
        if (ignoradas.has(low)) return false
        if (lixoApp.some(p => low.startsWith(p))) return false
        if (teclas >= 6 && l.length === 1) return false
        return true
    })
    return boas.join('\n').trim()
}

function formatarPacote(pedido) {
    if (pedido.isSaldo) return `Saldo ${pedido.saldoAmount || pedido.megasAmount} MT`
    const mb = Number(pedido.mbExibicao) || Number(pedido.megasAmount) || 0
    const bonusMb = Number(pedido.bonusMb) || 0
    if (bonusMb > 0) {
        const baseMb = Number(pedido.pacoteBaseMb) || Math.max(0, mb - bonusMb)
        return formatarPacoteComBonus(baseMb, bonusMb)
    }
    if (mb >= 1024) {
        const gb = (mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1).replace('.', ',')
        return `${gb} GB`
    }
    return `${Math.floor(mb)} MB`
}

function formatarTelefone(numero) {
    const n = String(numero || '')
    if (n.length === 9) return `+258 ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`
    return n
}

function obterNomeChip(pedido, remoto) {
    const raw = (remoto && remoto.simName) ||
        (remoto && Number.isInteger(remoto.simSlot) ? `SIM ${remoto.simSlot + 1}` : null) ||
        (pedido && pedido.simName) ||
        (pedido && Number.isInteger(pedido.targetSimSlot) ? `SIM ${pedido.targetSimSlot + 1}` : null) ||
        (pedido && Number.isInteger(pedido.simSlot) ? `SIM ${pedido.simSlot + 1}` : null)
    if (!raw) return null
    const str = String(raw).trim()
    const m = str.match(/SIM\s*[12]/i)
    if (m) return m[0].toUpperCase()
    return str
}

function formatarCardPedido(pedido, status, remoto) {
    const num = pedido?.numero || (pedido?.id ? String(pedido.id).replace(/^(?:PED|WA)\-/i, '') : '1')
    const numDisplay = `#${num}`
    const cliente = formatarTelefone(pedido?.clientePhone)
    const pacote = formatarPacote(pedido || {})
    const valorNum = Number(pedido?.valorPago || pedido?.valor) || 0
    const chip = obterNomeChip(pedido, remoto)
    const st = String(status || pedido?.status || 'PENDENTE').toUpperCase()

    const linhas = [
        `⚡ *FASTNET AUTO | PEDIDO ${numDisplay}*`,
        '┌────────────────────────',
        `│ 🧾 #PEDIDO: *${numDisplay}*`,
        `│ 📱 Destino: *${cliente}*`,
        `│ 📦 Quantidade: *${pacote}*`
    ]

    if (valorNum > 0) {
        linhas.push(`│ 💰 Valor: *${valorNum} MT*`)
    }
    if (chip) {
        linhas.push(`│ 📶 Linha: *${chip}*`)
    }
    if (pedido?.referenciaRecibo) {
        linhas.push(`│ 📋 Recibo: *${pedido.referenciaRecibo}*`)
    }

    linhas.push('└────────────────────────')

    const duracaoMs = Date.now() - (pedido?.criadoEm || Date.now())
    const duracaoSeg = Math.max(1, Math.round(duracaoMs / 1000))
    const tempoTexto = duracaoSeg < 60 ? `${duracaoSeg}s` : `${Math.floor(duracaoSeg / 60)}m ${duracaoSeg % 60}s`

    if (st === 'PENDENTE') {
        linhas.push('⏳ *Progresso:* [■□□□□] Na fila...')
    } else if (st === 'PROCESSANDO') {
        linhas.push('🔄 *Progresso:* [■■■□□] Discando USSD no celular...')
    } else if (st === 'SUCESSO' || st === 'CONCLUIDO') {
        linhas.push(`✅ *Progresso:* [■■■■■] Entregue (${tempoTexto})!`)
        const resposta = limparTextoResposta(remoto?.ussdResponseText)
        if (resposta) {
            linhas.push(`💬 _${resposta.slice(0, 300)}_`)
        } else {
            linhas.push('💬 _Transferência efectuada com sucesso_')
        }
        if (!pedido?.isSaldo) {
            linhas.push('', '💡 Digite *100*03# para consultar saldo.')
        }
    } else if (st === 'FALHA' || st === 'CANCELADO') {
        linhas.push(st === 'CANCELADO' ? '❌ *Progresso:* [■■■■■] Cancelado' : '❌ *Progresso:* [■■■■■] Falha no envio')
        const motivo = limparTextoResposta(remoto?.motivoErro || remoto?.erro || remoto?.ussdResponseText)
        if (motivo) {
            linhas.push(`💬 _${motivo.slice(0, 300)}_`)
        }
    } else if (st === 'EXPIRADO') {
        linhas.push('⚠️ *Progresso:* [■■■■■] Expirado (sem resposta em 10m)')
    } else if (st === 'DESAPARECIDO') {
        linhas.push('⚠️ *Progresso:* [■■■■■] Pedido cancelado no servidor')
    } else {
        linhas.push(`ℹ️ *Progresso:* ${st}`)
    }

    return linhas.join('\n')
}

function ehPacoteNormalCompra(pedido) {
    return Boolean(pedido?.compraId) && notificador.ehPacoteDados(pedido)
}

function identificacaoPedido(pedido) {
    const numero = Number(pedido?.numero)
    let referencia = ''
    if (Number.isFinite(numero) && numero > 0) {
        referencia = `#${numero}`
    } else {
        const id = String(pedido?.id || '')
        const encontrado = id.match(/^PED-(\d+)/i)
        referencia = encontrado ? `#${encontrado[1]}` : (id || 'N/A')
    }
    const parte = Math.max(0, parseInt(pedido?.parte, 10) || 0)
    const totalPartes = Math.max(0, parseInt(pedido?.totalPartes, 10) || 0)
    const detalhe = parte > 0 && totalPartes > 1 ? ` (parte ${parte}/${totalPartes})` : ''
    return `PEDIDO: *${referencia}${detalhe}*`
}

function formatarCardAntigo(pedido, status, remoto) {
    const st = String(status || pedido?.status || '').toUpperCase()
    if (st === 'PENDENTE' || !st) return null

    const cliente = formatarTelefone(pedido?.clientePhone)
    const pacote = formatarPacote(pedido || {})
    const chip = obterNomeChip(pedido, remoto)
    const linhaChip = chip ? [`📶 Chip: *${chip}*`] : []

    if (st === 'PROCESSANDO') {
        return [
            '⚡ *PEDIDO EM ANDAMENTO*',
            '────────────────────────',
            `🧾 ${identificacaoPedido(pedido)}`,
            `📱 Cliente: ${cliente}`,
            `📦 Pacote: ${pacote}`,
            ...linhaChip,
            '',
            '_O app acatou o pedido e já está a enviar por USSD._'
        ].join('\n')
    }

    if (st === 'SUCESSO' || st === 'CONCLUIDO') {
        const resposta = limparTextoResposta(remoto?.ussdResponseText)
        const linhas = [
            '✅ *PEDIDO CONCLUÍDO COM ÊXITO*',
            '────────────────────────',
            `🧾 ${identificacaoPedido(pedido)}`,
            `📱 Cliente: ${cliente}`,
            `📦 Pacote: ${pacote}`,
            ...linhaChip
        ]
        if (resposta) linhas.push('', `💬 ${resposta.slice(0, 300)}`)
        return linhas.join('\n')
    }

    if (st === 'FALHA' || st === 'CANCELADO') {
        const motivo = limparTextoResposta(remoto?.motivoErro || remoto?.erro || remoto?.ussdResponseText)
        const linhas = [
            '❌ *PEDIDO SEM ÊXITO*',
            '────────────────────────',
            `🧾 ${identificacaoPedido(pedido)}`,
            `📱 Cliente: ${cliente}`,
            `📦 Pacote: ${pacote}`,
            `⚠️ Estado: *${st}*`
        ]
        if (motivo) linhas.push('', `💬 ${motivo.slice(0, 300)}`)
        linhas.push('', '_Confira o app e envie outra vez se for preciso._')
        return linhas.join('\n')
    }

    if (st === 'EXPIRADO') {
        const minutos = Math.max(1, Math.round(
            (Number(pedido?.timeoutPendenteMs) || TIMEOUT_PENDENTE_MS) / 60000
        ))
        return [
            '⚠️ *PEDIDO EXPIRADO*',
            '────────────────────────',
            `🧾 ${identificacaoPedido(pedido)}`,
            `📱 Cliente: ${cliente}`,
            `📦 Pacote: ${pacote}`,
            '',
            `_O app não aceitou o pedido dentro de ${minutos} minutos. Confira a ligação do servidor e envie de novo._`
        ].join('\n')
    }

    if (st === 'DESAPARECIDO') {
        return [
            '⚠️ *PEDIDO APAGADO NO SERVIDOR*',
            '────────────────────────',
            `🧾 ${identificacaoPedido(pedido)}`,
            `📱 Cliente: ${cliente}`,
            `📦 Pacote: ${pacote}`,
            '',
            '_O pedido já não consta na fila do Firebase. Envie outra vez se o cliente ainda aguarda._'
        ].join('\n')
    }

    return null
}

function registrarVendaAuto(pedido) {
    if (!pedido || pedido.vendaRegistrada) return
    if (pedido.registrarNoMonitor === false) return
    if (!pedido.grupoId || !pedido.solicitadoPor) return

    const isSaldo = pedido.isSaldo === true
    const quantidade = Number(isSaldo ? (pedido.saldoAmount || pedido.megasAmount) : pedido.megasAmount) || 0
    if (quantidade <= 0) return

    const pacote = isSaldo ? `${quantidade}MT` : `${quantidade}MB`
    const chaveIdempotencia = criarChaveVenda(
        pedido.referenciaRecibo,
        pedido.clientePhone,
        quantidade,
        isSaldo
    ) || `AUTO:${pedido.id}`

    try {
        const stats = registrarVenda(
            pedido.grupoId,
            pedido.solicitadoPor,
            pedido.clienteNome || '',
            pacote,
            isSaldo,
            { chaveIdempotencia, forceSave: true }
        )
        if (!stats) return
        pedido.vendaRegistrada = true
        fila.atualizarPedido(pedido.id, {
            vendaRegistrada: true,
            vendaRegistradaEm: Date.now()
        })
    } catch (err) {
        console.error(`[AUTO-MONITOR] Falha ao registar venda do pedido ${pedido.id}:`, err.message)
    }
}

async function atualizarOuEnviarCard(sock, pedido, status, remoto) {
    if (!sock || !pedido || !pedido.grupoId) return
    const cardAntigo = ehPacoteNormalCompra(pedido)
    if (!cardAntigo && (pedido.silenciarCard || pedido.compraId || pedido.loteId)) return
    const chave = String(status).toLowerCase()
    if (pedido.notificacoes && pedido.notificacoes[chave]) return

    const chip = obterNomeChip(pedido, remoto)
    if (chip && chip !== pedido.simName) {
        fila.atualizarPedido(pedido.id, { simName: chip })
        pedido.simName = chip
    }

    const texto = cardAntigo
        ? formatarCardAntigo(pedido, status, remoto)
        : formatarCardPedido(pedido, status, remoto)
    if (!texto) return

    let editSucesso = false
    const msgKey = pedido.msgKey

    if (msgKey && msgKey.id) {
        try {
            await sock.sendMessage(pedido.grupoId, {
                text: texto,
                edit: {
                    id: msgKey.id,
                    remoteJid: msgKey.remoteJid || pedido.grupoId,
                    fromMe: true
                }
            })
            editSucesso = true
            fila.marcarNotificado(pedido.id, chave)
        } catch (errEdit) {
            console.warn(`[AUTO-MONITOR] Falha ao editar mensagem ${msgKey.id} do pedido ${pedido.id}:`, errEdit.message)
        }
    }

    if (!editSucesso) {
        try {
            const sent = await sock.sendMessage(pedido.grupoId, { text: texto })
            if (sent && sent.key) {
                fila.atualizarPedido(pedido.id, {
                    msgKey: sent.key,
                    msgId: sent.key.id
                })
                pedido.msgKey = sent.key
                pedido.msgId = sent.key.id
            }
            fila.marcarNotificado(pedido.id, chave)
        } catch (errSend) {
            console.error(`[AUTO-MONITOR] Falha ao enviar card do pedido ${pedido.id}:`, errSend.message)
            return
        }
    }

    if (pedido.msgKey) {
        try {
            const stUpper = String(status).toUpperCase()
            if (stUpper === 'SUCESSO' || stUpper === 'CONCLUIDO') {
                await sock.sendMessage(pedido.grupoId, { react: { text: '✅', key: pedido.msgKey } })
            } else if (stUpper === 'FALHA' || stUpper === 'CANCELADO') {
                await sock.sendMessage(pedido.grupoId, { react: { text: '❌', key: pedido.msgKey } })
            } else if (stUpper === 'PROCESSANDO') {
                await sock.sendMessage(pedido.grupoId, { react: { text: '🔄', key: pedido.msgKey } })
            }
        } catch {}
    }
}

function limparAntigos() {
    const agora = Date.now()
    const grupos = new Set()
    for (const pedido of fila.listarTodos()) {
        if (!STATUS_FINAIS.includes(pedido.status)) continue
        if (agora - (pedido.atualizadoEm || pedido.criadoEm || 0) <= LIMPEZA_IDADE_MS) continue
        if (pedido.grupoId) grupos.add(pedido.grupoId)
    }
    for (const grupoId of grupos) fila.limparFinalizados(grupoId)
}

async function talvezProcessarEspera(sock) {
    if (processandoEspera) return
    if (Date.now() - ultimaTentativaEspera < 60000) return
    processandoEspera = true
    ultimaTentativaEspera = Date.now()
    try {
        await fluxoCompra.processarComprasEmEspera(sock)
        await envioMassivo.retomarLotesPendentes(sock)
    } catch (err) {
        console.error('[AUTO-MONITOR] Falha ao reprocessar compras/lotes em espera:', err.message)
    } finally {
        processandoEspera = false
    }
}

async function executarCiclo() {
    if (rodando || preparando) return
    const sock = typeof obterSock === 'function' ? obterSock() : null
    if (!sock) return

    preparando = true
    try {
        await talvezProcessarEspera(sock)
        await reatribuidor.processarReatribuicoes()
    } finally {
        preparando = false
    }
    if (rodando) return

    // Inclui pedidos finais recentes para captar correções do app (ex.: FALHA -> SUCESSO).
    const agoraBase = Date.now()
    const ativos = fila.listarTodos().filter(p =>
        !STATUS_FINAIS.includes(p.status) || (agoraBase - (p.atualizadoEm || 0)) < JANELA_CORRECAO_MS
    )
    if (ativos.length === 0) return

    rodando = true
    try {
        const porCentral = new Map()
        for (const pedido of ativos) {
            if (!pedido.centralCode) continue
            if (!porCentral.has(pedido.centralCode)) porCentral.set(pedido.centralCode, [])
            porCentral.get(pedido.centralCode).push(pedido)
        }

        for (const [centralCode, pedidos] of porCentral) {
            const remotos = await fetchFirebase(`device_pairings/${centralCode}/vendas_pendentes`)
            if (remotos === null) continue

            for (const pedido of pedidos) {
                const remoto = remotos[pedido.id]
                const agora = Date.now()

                if (!remoto) {
                    if (!STATUS_FINAIS.includes(pedido.status) && agora - (pedido.criadoEm || agora) > DESAPARECIDO_MS) {
                        fila.atualizarPedido(pedido.id, { status: 'DESAPARECIDO' })
                        const atualizado = fila.buscarPorId(pedido.id) || pedido
                        if (atualizado.compraId) {
                            await atualizarOuEnviarCard(sock, atualizado, 'DESAPARECIDO', null)
                            await fluxoCompra.processarStatusPedido(sock, atualizado, 'DESAPARECIDO', null)
                        } else if (atualizado.loteId) {
                            await envioMassivo.processarStatusPedido(sock, atualizado, 'DESAPARECIDO')
                        } else {
                            await atualizarOuEnviarCard(sock, atualizado, 'DESAPARECIDO', null)
                        }
                    }
                    continue
                }

                let statusRemoto = String(remoto.status || 'PENDENTE').toUpperCase()

                // Se o app já corrigiu pelo VALIDAR0 no próprio aparelho ou foi falso erro de 0 MB, aceita como sucesso
                if (remoto.corrigidoPor === 'VALIDAR0' || isFalsoErroMinimoZero(remoto)) {
                    statusRemoto = 'SUCESSO'
                    remoto.status = 'SUCESSO'
                }

                const pedidoAtual = fila.buscarPorId(pedido.id) || pedido

                // Se o pedido ainda não enviou mensagem inicial no WhatsApp, envia agora
                if (!pedidoAtual.msgKey && pedidoAtual.grupoId) {
                    await atualizarOuEnviarCard(sock, pedidoAtual, pedidoAtual.status || 'PENDENTE', remoto)
                }

                if (statusRemoto !== pedidoAtual.statusRemoto) {
                    fila.atualizarPedido(pedido.id, { statusRemoto })
                }

                if (STATUS_FINAIS.includes(statusRemoto)) {
                    if (pedidoAtual.status !== statusRemoto) {
                        fila.atualizarPedido(pedido.id, { status: statusRemoto })
                        pedidoAtual.status = statusRemoto
                    }
                    if (pedidoAtual.compraId) {
                        await atualizarOuEnviarCard(sock, pedidoAtual, statusRemoto, remoto)
                        await fluxoCompra.processarStatusPedido(sock, pedidoAtual, statusRemoto, remoto)
                    } else if (pedidoAtual.loteId) {
                        await envioMassivo.processarStatusPedido(sock, pedidoAtual, statusRemoto)
                    } else {
                        if (statusRemoto === 'SUCESSO' || statusRemoto === 'CONCLUIDO') {
                            registrarVendaAuto(pedidoAtual)
                        }
                        await atualizarOuEnviarCard(sock, pedidoAtual, statusRemoto, remoto)
                    }
                    continue
                }

                if (statusRemoto === 'PROCESSANDO') {
                    if (pedidoAtual.status !== 'PROCESSANDO') {
                        fila.atualizarPedido(pedido.id, { status: 'PROCESSANDO' })
                        pedidoAtual.status = 'PROCESSANDO'
                    }
                    await atualizarOuEnviarCard(sock, pedidoAtual, 'PROCESSANDO', remoto)
                    continue
                }

                const timeoutPendente = Number(pedidoAtual.timeoutPendenteMs) || TIMEOUT_PENDENTE_MS
                if (agora - (pedidoAtual.criadoEm || agora) > timeoutPendente && !STATUS_FINAIS.includes(pedidoAtual.status)) {
                    fila.atualizarPedido(pedido.id, { status: 'EXPIRADO' })
                    pedidoAtual.status = 'EXPIRADO'
                    if (pedidoAtual.compraId) {
                        await atualizarOuEnviarCard(sock, pedidoAtual, 'EXPIRADO', remoto)
                        await fluxoCompra.processarStatusPedido(sock, pedidoAtual, 'EXPIRADO', remoto)
                    } else if (pedidoAtual.loteId) {
                        await envioMassivo.processarStatusPedido(sock, pedidoAtual, 'EXPIRADO')
                    } else {
                        await atualizarOuEnviarCard(sock, pedidoAtual, 'EXPIRADO', remoto)
                    }
                }
            }
        }

        limparAntigos()
    } catch (err) {
        console.error('[AUTO-MONITOR] Erro no ciclo:', err.message)
    } finally {
        rodando = false
    }
}

function iniciarMonitor(getSock) {
    if (timer) return
    obterSock = getSock
    timer = setInterval(() => {
        executarCiclo().catch(() => {})
    }, INTERVALO_MS)
    if (typeof timer.unref === 'function') timer.unref()
    console.log('[AUTO-MONITOR] Monitor de pedidos automáticos iniciado.')
    executarCiclo().catch(() => {})
}

function pararMonitor() {
    if (!timer) return
    clearInterval(timer)
    timer = null
    console.log('[AUTO-MONITOR] Monitor de pedidos automáticos parado.')
}

module.exports = {
    iniciarMonitor,
    pararMonitor,
    executarCiclo,
    formatarCardPedido,
    formatarCardAntigo,
    obterNomeChip,
    atualizarOuEnviarCard,
    registrarVendaAuto
}

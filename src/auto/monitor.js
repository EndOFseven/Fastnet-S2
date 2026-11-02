const fila = require('./fila')
const { fetchFirebase, patchFirebase } = require('../utils/firebaseConfig')

const INTERVALO_MS = 8000
const TIMEOUT_PENDENTE_MS = 10 * 60 * 1000
const DESAPARECIDO_MS = 90 * 1000
const LIMPEZA_IDADE_MS = 7 * 24 * 60 * 60 * 1000
const JANELA_CORRECAO_MS = 15 * 60 * 1000
const STATUS_FINAIS = ['SUCESSO', 'CONCLUIDO', 'FALHA', 'CANCELADO', 'EXPIRADO', 'DESAPARECIDO']

let timer = null
let rodando = false
let obterSock = null

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
    const mb = Number(pedido.megasAmount) || 0
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

function textoStatus(pedido, status, remoto) {
    const id = pedido.id
    const cliente = formatarTelefone(pedido.clientePhone)
    const pacote = formatarPacote(pedido)

    const simDetectado = (remoto && remoto.simName) ||
        (remoto && Number.isInteger(remoto.simSlot) ? `SIM ${remoto.simSlot + 1}` : null) ||
        (pedido && pedido.simName) ||
        (pedido && Number.isInteger(pedido.targetSimSlot) ? `SIM ${pedido.targetSimSlot + 1}` : null)
    const linhaSim = simDetectado ? `📶 Chip: *${simDetectado}*` : ''

    if (status === 'PROCESSANDO') {
        const linhas = [
            '⚡ *PEDIDO EM ANDAMENTO*',
            '────────────────────────',
            `🧾 ID: *${id}*`,
            `📱 Cliente: ${cliente}`,
            `📦 Pacote: ${pacote}`
        ]
        if (linhaSim) linhas.push(linhaSim)
        linhas.push('', '_O app acatou o pedido e já está a enviar por USSD._')
        return linhas.join('\n')
    }

    if (status === 'SUCESSO' || status === 'CONCLUIDO') {
        const resposta = limparTextoResposta(remoto?.ussdResponseText)
        const linhas = [
            '✅ *PEDIDO CONCLUÍDO COM ÊXITO*',
            '────────────────────────',
            `🧾 ID: *${id}*`,
            `📱 Cliente: ${cliente}`,
            `📦 Pacote: ${pacote}`
        ]
        if (linhaSim) linhas.push(linhaSim)
        if (resposta) linhas.push('', `💬 ${resposta.slice(0, 300)}`)
        return linhas.join('\n')
    }

    if (status === 'FALHA' || status === 'CANCELADO') {
        const motivo = limparTextoResposta(remoto?.motivoErro || remoto?.erro || remoto?.ussdResponseText)
        const linhas = [
            '❌ *PEDIDO SEM ÊXITO*',
            '────────────────────────',
            `🧾 ID: *${id}*`,
            `📱 Cliente: ${cliente}`,
            `📦 Pacote: ${pacote}`,
            `⚠️ Estado: *${status}*`
        ]
        if (motivo) linhas.push('', `💬 ${motivo.slice(0, 300)}`)
        linhas.push('', '_Confira o app e envie outra vez se for preciso._')
        return linhas.join('\n')
    }

    if (status === 'EXPIRADO') {
        return [
            '⚠️ *PEDIDO EXPIRADO*',
            '────────────────────────',
            `🧾 ID: *${id}*`,
            `📱 Cliente: ${cliente}`,
            `📦 Pacote: ${pacote}`,
            '',
            '_O app não aceitou o pedido dentro de 10 minutos. Confira a ligação do servidor e envie de novo._'
        ].join('\n')
    }

    if (status === 'DESAPARECIDO') {
        return [
            '⚠️ *PEDIDO APAGADO NO SERVIDOR*',
            '────────────────────────────',
            `🧾 ID: *${id}*`,
            `📱 Cliente: ${cliente}`,
            `📦 Pacote: ${pacote}`,
            '',
            '_O pedido já não consta na fila do Firebase. Envie outra vez se o cliente ainda aguarda._'
        ].join('\n')
    }

    return null
}

async function notificar(sock, pedido, status, remoto) {
    const chave = String(status).toLowerCase()
    if (pedido.notificacoes && pedido.notificacoes[chave]) return
    const texto = textoStatus(pedido, status, remoto)
    if (!texto || !pedido.grupoId) return
    try {
        await sock.sendMessage(pedido.grupoId, { text: texto })
        fila.marcarNotificado(pedido.id, chave)
    } catch (err) {
        console.error(`[AUTO-MONITOR] Falha ao notificar ${pedido.id} em ${pedido.grupoId}:`, err.message)
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

async function executarCiclo() {
    if (rodando) return
    const sock = typeof obterSock === 'function' ? obterSock() : null
    if (!sock) return

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
                        await notificar(sock, atualizado, 'DESAPARECIDO', null)
                    }
                    continue
                }

                let statusRemoto = String(remoto.status || 'PENDENTE').toUpperCase()

                // Se o app já corrigiu pelo VALIDAR0 no próprio aparelho, aceita como sucesso
                if (remoto.corrigidoPor === 'VALIDAR0') {
                    statusRemoto = 'SUCESSO'
                    remoto.status = 'SUCESSO'
                }

                const pedidoAtual = fila.buscarPorId(pedido.id) || pedido

                if (statusRemoto !== pedidoAtual.statusRemoto) {
                    fila.atualizarPedido(pedido.id, { statusRemoto })
                }

                if (STATUS_FINAIS.includes(statusRemoto)) {
                    if (pedidoAtual.status !== statusRemoto) {
                        fila.atualizarPedido(pedido.id, { status: statusRemoto })
                    }
                    await notificar(sock, pedidoAtual, statusRemoto, remoto)
                    continue
                }

                if (statusRemoto === 'PROCESSANDO') {
                    if (pedidoAtual.status !== 'PROCESSANDO') {
                        fila.atualizarPedido(pedido.id, { status: 'PROCESSANDO' })
                    }
                    await notificar(sock, pedidoAtual, 'PROCESSANDO', remoto)
                    continue
                }

                if (agora - (pedidoAtual.criadoEm || agora) > TIMEOUT_PENDENTE_MS && !STATUS_FINAIS.includes(pedidoAtual.status)) {
                    fila.atualizarPedido(pedido.id, { status: 'EXPIRADO' })
                    await notificar(sock, pedidoAtual, 'EXPIRADO', remoto)
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
    executarCiclo
}

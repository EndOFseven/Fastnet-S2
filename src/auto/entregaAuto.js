const { obterVinculo } = require('./vinculo')
const { enfileirar, listarTodos, STATUS_ATIVOS, normalizarTelefone, atualizarPedido, marcarNotificado } = require('./fila')
const { fetchFirebase } = require('../utils/firebaseConfig')
const { formatarCardPedido } = require('./monitor')

async function obterMelhorSlotParaEntrega(centralCode, mb, isSaldo) {
    try {
        const simData = await fetchFirebase(`device_pairings/${centralCode}/sim_status`)
        const telemetria = (await fetchFirebase(`device_pairings/${centralCode}/telemetria`)) || {}
        if (!simData || typeof simData !== 'object') return null

        let dev = null
        for (const [id, d] of Object.entries(simData)) {
            const tel = telemetria[id] || {}
            if (String(tel.papel || '').toUpperCase() === 'RECEBER_PAGAMENTOS') continue
            if (d && (d.sim1 || d.sim2)) {
                dev = d
                break
            }
        }
        if (!dev) dev = Object.values(simData).find(d => d && (d.sim1 || d.sim2))
        if (!dev) return null

        const s1 = dev.sim1 || {}
        const s2 = dev.sim2 || {}
        const s1Total = (s1.total && s1.total > 0) ? s1.total : 10
        const s2Total = (s2.total && s2.total > 0) ? s2.total : 10
        const s1Bloqueado = Boolean(s1.bloqueadoHoje || (Number(s1.usado) >= s1Total))
        const s2Bloqueado = Boolean(s2.bloqueadoHoje || (Number(s2.usado) >= s2Total))

        if (isSaldo) {
            const s1Saldo = Number(s1.saldo) || 0
            const s2Saldo = Number(s2.saldo) || 0
            const s1Ok = !s1Bloqueado && (mb <= 0 || s1Saldo >= mb)
            const s2Ok = !s2Bloqueado && (mb <= 0 || s2Saldo >= mb)
            if (s1Ok && !s2Ok) return 0
            if (!s1Ok && s2Ok) return 1
            if (s1Ok && s2Ok) return s2Saldo > s1Saldo ? 1 : 0
            return null
        }

        const s1Megas = Number(s1.megas) || 0
        const s2Megas = Number(s2.megas) || 0
        const s1Ok = !s1Bloqueado && s1Megas >= mb
        const s2Ok = !s2Bloqueado && s2Megas >= mb
        if (s1Ok && !s2Ok) return 0
        if (!s1Ok && s2Ok) return 1
        if (s1Ok && s2Ok) return s2Megas > s1Megas ? 1 : 0
        return null
    } catch {
        return null
    }
}

function detectarSaldo(item, tipoPacote) {
    if (item && item.saldo !== undefined && item.saldo !== null) return true
    return /saldo/i.test(String(tipoPacote || ''))
}

function jaEnfileirado(referencia, numero) {
    if (!referencia) return false
    const telefone = normalizarTelefone(numero)
    if (!telefone) return false
    return listarTodos().some(p =>
        p.referenciaRecibo === referencia &&
        p.clientePhone === telefone &&
        STATUS_ATIVOS.includes(p.status)
    )
}

async function enfileirarEntregas({ sock, from, sender, pedidos, codigo, nome, valorTotal, tipoPacote, ussdMethod }) {
    const vinculo = obterVinculo(from)
    if (!vinculo.centralCode || !vinculo.autoAtivo) {
        return { ok: false, motivo: 'grupo-sem-central', resultados: [] }
    }
    if (!Array.isArray(pedidos) || pedidos.length === 0) {
        return { ok: false, motivo: 'sem-pedidos', resultados: [] }
    }

    const resultados = []
    for (const item of pedidos) {
        const isSaldo = detectarSaldo(item, tipoPacote)
        const mb = parseInt(isSaldo ? (item.saldo || item.mb) : item.mb, 10) || 0
        const valor = Number(item.valor) || Number(valorTotal) || 0

        if (jaEnfileirado(codigo, item.numero)) {
            resultados.push({ numero: item.numero, ok: false, motivo: 'pedido-ja-enfileirado' })
            continue
        }

        const slotCalculado = await obterMelhorSlotParaEntrega(vinculo.centralCode, mb, isSaldo)

        const res = await enfileirar({
            centralCode: vinculo.centralCode,
            grupoId: from,
            clientePhone: item.numero,
            megasAmount: mb,
            saldoAmount: isSaldo ? mb : 0,
            valorPago: valor,
            isSaldo,
            ussdMethod: ussdMethod || (isSaldo ? '*111#' : '*162#'),
            targetSimSlot: slotCalculado,
            simName: Number.isInteger(slotCalculado) ? `SIM ${slotCalculado + 1}` : null,
            tipoPacote: isSaldo ? 'Saldo' : (tipoPacote || ''),
            packageCategory: isSaldo ? 'SALDO' : '',
            solicitadoPor: sender,
            referenciaRecibo: codigo || '',
            clienteNome: nome || ''
        })

        if (res.ok && res.pedido && sock && from) {
            try {
                const cardTxt = formatarCardPedido(res.pedido, 'PENDENTE', null)
                const sent = await sock.sendMessage(from, { text: cardTxt })
                if (sent && sent.key) {
                    atualizarPedido(res.pedido.id, {
                        msgKey: sent.key,
                        msgId: sent.key.id
                    })
                    marcarNotificado(res.pedido.id, 'pendente')
                    res.pedido.msgKey = sent.key
                    res.pedido.msgId = sent.key.id
                }
            } catch (errCard) {
                console.warn('[AUTO-ENTREGA] Falha ao enviar card inicial do pedido:', errCard.message)
            }
        }

        resultados.push({
            numero: item.numero,
            ok: res.ok,
            motivo: res.motivo,
            pedido: res.pedido,
            displayPacote: item.displayPacote || item.gb || `${mb}MB`
        })
    }

    return {
        ok: resultados.some(r => r.ok),
        centralCode: vinculo.centralCode,
        resultados
    }
}

module.exports = { enfileirarEntregas }

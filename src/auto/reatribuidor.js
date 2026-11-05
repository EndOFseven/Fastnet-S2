const fila = require('./fila')
const fluxoCompra = require('./fluxoCompra')
const envioMassivo = require('./envioMassivo')
const { obterCapacidadeSims, distribuirPartes } = require('./simSelector')
const { fetchFirebase, fetchFirebaseComEtag, putFirebaseComIfMatch } = require('../utils/firebaseConfig')
const { comLock } = require('./enfileiramentoLock')
const { baseMbDoPedido } = require('./partePedido')

const INTERVALO_MS = 60 * 1000

let ultimaExecucao = 0
let executando = false

async function processarInterno() {
    const porCentral = new Map()
    for (const pedido of fila.listarAtivos()) {
        if (pedido.status !== 'PENDENTE') continue
        const alvo = String(pedido.targetDeviceId || '').trim()
        if (!alvo) continue
        if (!pedido.centralCode) continue
        const code = String(pedido.centralCode).trim().toUpperCase()
        if (!porCentral.has(code)) porCentral.set(code, [])
        porCentral.get(code).push(pedido)
    }

    let reatribuidos = 0

    for (const [centralCode, pedidos] of porCentral) {
        const remotos = await fetchFirebase(`device_pairings/${centralCode}/vendas_pendentes`)
        if (!remotos || typeof remotos !== 'object') continue

        let capacidade = null
        let dispositivosOnline = null
        let simDataLido = false

        for (const pedido of pedidos) {
            const remoto = remotos[pedido.id]
            if (!remoto || String(remoto.status || '').toUpperCase() !== 'PENDENTE') continue

            const alvoAtual = String(remoto.targetDeviceId || pedido.targetDeviceId || '').trim()
            if (!simDataLido) {
                simDataLido = true
                const simData = await fetchFirebase(`device_pairings/${centralCode}/sim_status`)
                const telemetria = (await fetchFirebase(`device_pairings/${centralCode}/telemetria`)) || {}
                if (!simData || typeof simData !== 'object') {
                    capacidade = null
                } else {
                    const { listarDispositivos } = require('./simSelector')
                    dispositivosOnline = new Set(listarDispositivos(simData, telemetria).map(d => String(d.id)))
                    capacidade = { simData, telemetria }
                }
            }

            if (!capacidade) break
            if (dispositivosOnline.has(alvoAtual)) continue

            const baseMb = baseMbDoPedido(pedido)
            if (baseMb <= 0) continue

            const cap = await obterCapacidadeSims(centralCode, {
                ignorarPedidoId: pedido.id,
                excluirDeviceIds: [alvoAtual]
            })
            const distribuicao = distribuirPartes([baseMb], cap)
            if (!distribuicao.ok || distribuicao.atribuicoes.length === 0) {
                console.warn(`[REATRIBUIDOR] Sem capacidade para ${pedido.id} em ${centralCode}: ${distribuicao.erro || distribuicao.motivo || 'sem destino'}`)
                continue
            }

            const atribuicao = distribuicao.atribuicoes[0]
            if (!atribuicao.dispositivoId) continue

            const path = `device_pairings/${centralCode}/vendas_pendentes/${pedido.id}`
            const atualSnap = await fetchFirebaseComEtag(path)
            const atual = atualSnap.data
            if (!atual || String(atual.status || '').toUpperCase() !== 'PENDENTE') continue
            const alvoRemoto = String(atual.targetDeviceId || '').trim()
            if (alvoRemoto && alvoRemoto !== alvoAtual) continue

            const agora = Date.now()
            const atualizado = {
                ...atual,
                status: 'PENDENTE',
                targetDeviceId: atribuicao.dispositivoId,
                targetSimSlot: atribuicao.slot,
                simSlot: atribuicao.slot,
                simName: atribuicao.simNome,
                megasAmount: atribuicao.mbEnvio,
                targetAssignedEm: agora,
                reatribuidoEm: agora,
                reatribuidoDe: alvoAtual,
                assumidoPor: null,
                assumidoEm: null
            }
            const enviado = await putFirebaseComIfMatch(path, atualizado, atualSnap.etag)
            if (!enviado.ok) {
                const motivo = enviado.conflito ? 'pedido mudou de estado' : 'falha de escrita'
                console.warn(`[REATRIBUIDOR] Reatribuição de ${pedido.id} abortada: ${motivo}`)
                continue
            }

            if (pedido.compraId) {
                fluxoCompra.atualizarParteReatribuida(pedido.id, atribuicao)
            } else if (pedido.loteId) {
                envioMassivo.atualizarParteReatribuida(pedido.id, atribuicao)
            }

            fila.atualizarPedido(pedido.id, {
                targetDeviceId: atribuicao.dispositivoId,
                targetSimSlot: atribuicao.slot,
                simSlot: atribuicao.slot,
                simName: atribuicao.simNome,
                megasAmount: atribuicao.mbEnvio,
                targetAssignedEm: agora,
                reatribuidoEm: agora,
                reatribuidoDe: alvoAtual
            })

            reatribuidos++
            console.log(`[REATRIBUIDOR] ${pedido.id} movido de ${alvoAtual || '(vazio)'} para ${atribuicao.dispositivoId}/${atribuicao.simNome}`)
        }
    }

    return reatribuidos
}

function processarReatribuicoes() {
    if (executando) return Promise.resolve(0)
    if (Date.now() - ultimaExecucao < INTERVALO_MS) return Promise.resolve(0)
    executando = true
    ultimaExecucao = Date.now()

    return comLock(processarInterno)
        .catch(err => {
            console.error('[REATRIBUIDOR] Erro no ciclo:', err.message)
            return 0
        })
        .finally(() => {
            executando = false
        })
}

module.exports = {
    INTERVALO_MS,
    processarReatribuicoes,
    baseMbDoPedido
}

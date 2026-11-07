const { fetchFirebase } = require('../utils/firebaseConfig')
const fila = require('./fila')
const { MAX_PART_MB, normalizarMb } = require('./planejadorPartes')

const LIMITE_DIARIO_PADRAO = 10
const HEARTBEAT_MAX_MS = 5 * 60 * 1000
const PAPEIS_MB = new Set(['DISPARADOR_MEGAS', 'TUDO_EM_UM'])

function numero(valor, padrao = 0) {
    const n = Number(valor)
    return Number.isFinite(n) ? n : padrao
}

function timestampMs(valor) {
    if (valor === null || valor === undefined || valor === '') return 0
    if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0
    const texto = String(valor).trim()
    if (!texto) return 0
    if (/^\d+$/.test(texto)) return Number(texto)
    const parsed = Date.parse(texto)
    return Number.isFinite(parsed) ? parsed : 0
}

function papelDispositivo(dispositivo, telemetria) {
    return String(dispositivo?.papel || telemetria?.papel || '').trim().toUpperCase()
}

function dispositivoOnline(dispositivo, telemetria, agora = Date.now()) {
    const heartbeat = timestampMs(
        dispositivo?.heartbeat ||
        dispositivo?.heartbeatEm ||
        dispositivo?.atualizadoEm ||
        telemetria?.heartbeat ||
        telemetria?.heartbeatEm ||
        telemetria?.atualizadoEm
    )
    if (!heartbeat) return true
    return agora - heartbeat <= HEARTBEAT_MAX_MS
}

function listarDispositivos(simData, telemetria = {}, opcoes = {}) {
    if (!simData || typeof simData !== 'object') return []
    const agora = numero(opcoes.agora, Date.now())
    const excluir = new Set((opcoes.excluirDeviceIds || []).map(id => String(id)))
    const lista = []

    for (const [id, dispositivo] of Object.entries(simData)) {
        if (!dispositivo || typeof dispositivo !== 'object') continue
        if (excluir.has(String(id))) continue

        const tel = telemetria[id] || {}
        const papel = papelDispositivo(dispositivo, tel)
        if (papel === 'RECEBER_PAGAMENTOS') continue
        if (papel && !PAPEIS_MB.has(papel)) continue
        if (/^celular_\d+/i.test(id) && !telemetria[id] && !dispositivo.atualizadoEm && !dispositivo.heartbeat) continue
        if (!dispositivoOnline(dispositivo, tel, agora)) continue

        const sims = []
        if (dispositivo.sim1 && dispositivo.sim1Present !== false) {
            sims.push({ slot: 0, dados: dispositivo.sim1 })
        }
        if (dispositivo.sim2 && dispositivo.sim2Present !== false) {
            sims.push({ slot: 1, dados: dispositivo.sim2 })
        }
        if (sims.length === 0) continue

        lista.push({ id, dispositivo, telemetria: tel, papel, sims })
    }

    return lista
}

function selecionarDispositivo(simData, telemetria, opcoes = {}) {
    return listarDispositivos(simData, telemetria, opcoes)[0] || null
}

function resumoAtivos(centralCode, opcoes = {}) {
    const porDispositivo = new Map()
    const global = {
        porSlot: { 0: 0, 1: 0 },
        megasPorSlot: { 0: 0, 1: 0 },
        semSlot: 0,
        megasSemSlot: 0
    }
    const ignorarPedidoId = opcoes.ignorarPedidoId ? String(opcoes.ignorarPedidoId) : null
    const excluirDeviceIds = new Set((opcoes.excluirDeviceIds || []).map(id => String(id)))

    const bucket = (id) => {
        if (!porDispositivo.has(id)) {
            porDispositivo.set(id, {
                porSlot: { 0: 0, 1: 0 },
                megasPorSlot: { 0: 0, 1: 0 }
            })
        }
        return porDispositivo.get(id)
    }

    for (const pedido of fila.listarAtivos()) {
        if (ignorarPedidoId && String(pedido.id) === ignorarPedidoId) continue
        if (String(pedido.centralCode || '').toUpperCase() !== String(centralCode || '').toUpperCase()) continue
        if (excluirDeviceIds.has(String(pedido.targetDeviceId || ''))) continue

        const megas = pedido.isSaldo ? 0 : Math.max(0, Number(pedido.megasAmount) || 0)
        const targetDeviceId = String(pedido.targetDeviceId || '').trim()

        if (targetDeviceId) {
            const alvo = bucket(targetDeviceId)
            const slot = pedido.targetSimSlot === 0 || pedido.targetSimSlot === 1 ? pedido.targetSimSlot : 0
            alvo.porSlot[slot]++
            alvo.megasPorSlot[slot] += megas
            continue
        }

        if (pedido.targetSimSlot === 0 || pedido.targetSimSlot === 1) {
            global.porSlot[pedido.targetSimSlot]++
            global.megasPorSlot[pedido.targetSimSlot] += megas
        } else {
            global.semSlot++
            global.megasSemSlot += megas
        }
    }

    return { porDispositivo, global }
}

function ativosPorSlot(centralCode) {
    return resumoAtivos(centralCode).global.porSlot
}

function montarSim(slot, dados, ativos, megasAtivos = 0, dispositivoId = null) {
    const total = Math.max(1, numero(dados.total, LIMITE_DIARIO_PADRAO))
    const usado = Math.max(0, numero(dados.usado, 0))
    const restantes = Math.max(0, total - usado - ativos)
    const estoqueMb = Math.max(0, numero(dados.megas, 0) - Math.max(0, numero(megasAtivos, 0)))
    return {
        dispositivoId,
        deviceId: dispositivoId,
        slot,
        nome: slot === 0 ? 'SIM 1' : 'SIM 2',
        total,
        usado,
        ativos,
        restantes,
        estoqueMb,
        bloqueadoHoje: Boolean(dados.bloqueadoHoje),
        bloqueado: Boolean(dados.bloqueadoHoje) || restantes <= 0
    }
}

function montarCapacidade(simData, telemetria, ativos, centralCode, opcoes = {}) {
    const dispositivos = listarDispositivos(simData, telemetria, opcoes)
    if (dispositivos.length === 0) {
        return { ok: false, motivo: 'sem-telemetria', erro: 'Nenhum dispositivo com chips disponível.' }
    }

    const sims = []
    for (const dispositivo of dispositivos) {
        const reservas = ativos.porDispositivo.get(dispositivo.id) || {
            porSlot: { 0: 0, 1: 0 },
            megasPorSlot: { 0: 0, 1: 0 }
        }
        for (const sim of dispositivo.sims) {
            sims.push(montarSim(
                sim.slot,
                sim.dados,
                reservas.porSlot[sim.slot],
                reservas.megasPorSlot[sim.slot],
                dispositivo.id
            ))
        }
    }

    if (sims.length === 0) {
        return { ok: false, motivo: 'sem-telemetria', erro: 'Nenhum chip configurado no aplicativo.' }
    }

    return {
        ok: true,
        centralCode,
        dispositivos: dispositivos.map(d => d.id),
        sims,
        ativosSemSlot: ativos.global.semSlot,
        estoqueReservadoSemSlot: ativos.global.megasSemSlot,
        reservasGlobais: {
            porSlot: ativos.global.porSlot,
            megasPorSlot: ativos.global.megasPorSlot
        },
        capacidadePartes: Math.max(
            0,
            sims.reduce((soma, sim) => soma + (sim.bloqueado ? 0 : sim.restantes), 0) -
            ativos.global.semSlot -
            ativos.global.porSlot[0] -
            ativos.global.porSlot[1]
        ),
        estoqueTotalMb: sims.reduce((soma, sim) => soma + sim.estoqueMb, 0)
    }
}

async function obterCapacidadeSims(centralCode, opcoes = {}) {
    const codigo = String(centralCode || '').trim().toUpperCase()
    if (!codigo) return { ok: false, motivo: 'sem-servidor', erro: 'Grupo sem servidor vinculado.' }

    let simData = null
    let telemetria = {}
    try {
        const statusCentral = await fetchFirebase(`device_pairings/${codigo}/info/status`)
        if (String(statusCentral || '').toUpperCase() === 'REVOGADO') {
            return { ok: false, motivo: 'servidor-revogado', erro: 'Este servidor foi desativado pelo administrador.' }
        }
        simData = await fetchFirebase(`device_pairings/${codigo}/sim_status`)
        telemetria = (await fetchFirebase(`device_pairings/${codigo}/telemetria`)) || {}
    } catch (err) {
        return { ok: false, motivo: 'sem-telemetria', erro: `Não foi possível ler a telemetria: ${err.message}` }
    }

    if (!simData || typeof simData !== 'object') {
        return { ok: false, motivo: 'sem-telemetria', erro: 'O aplicativo ainda não publicou o estado dos chips.' }
    }

    const ativos = resumoAtivos(codigo, opcoes)
    return montarCapacidade(simData, telemetria, ativos, codigo, opcoes)
}

function aplicarReservasGlobais(sims, reservas) {
    if (!reservas) return { ok: true }
    const porSlot = reservas.porSlot || {}
    const megasPorSlot = reservas.megasPorSlot || {}

    for (const slot of [0, 1]) {
        let quantidade = Math.max(0, numero(porSlot[slot], 0))
        while (quantidade > 0) {
            const candidato = sims
                .filter(sim => sim.slot === slot && !sim.bloqueado && sim.restantes > 0)
                .sort((a, b) => b.restantes - a.restantes || b.estoqueMb - a.estoqueMb)[0]
            if (!candidato) return { ok: false, motivo: 'sem-capacidade', erro: 'Os chips não têm capacidade diária disponível.' }
            candidato.restantes -= 1
            quantidade -= 1
        }

        let megas = Math.max(0, numero(megasPorSlot[slot], 0))
        while (megas > 0) {
            const candidato = sims
                .filter(sim => sim.slot === slot && sim.estoqueMb > 0)
                .sort((a, b) => b.estoqueMb - a.estoqueMb)[0]
            if (!candidato) return { ok: false, motivo: 'sem-estoque', erro: 'Estoque de megas insuficiente para os pedidos em fila.' }
            const consumo = Math.min(candidato.estoqueMb, megas)
            candidato.estoqueMb -= consumo
            megas -= consumo
        }
    }

    return { ok: true }
}

function distribuirPartes(partes, capacidade) {
    if (!capacidade || !capacidade.ok) {
        return {
            ok: false,
            motivo: capacidade?.motivo || 'sem-telemetria',
            erro: capacidade?.erro || 'Telemetria indisponível.'
        }
    }

    const lista = (Array.isArray(partes) ? partes : []).map(normalizarMb)
    if (lista.length === 0) return { ok: true, atribuicoes: [] }
    if (lista.some(p => p <= 0)) return { ok: false, motivo: 'parte-invalida', erro: 'Parte de megas inválida.' }
    if (lista.some(p => p > MAX_PART_MB)) {
        return { ok: false, motivo: 'parte-grande', erro: `Cada parte deve ter no máximo ${MAX_PART_MB}MB.` }
    }

    const sims = capacidade.sims.map(sim => ({
        ...sim,
        restantes: sim.bloqueado ? 0 : sim.restantes,
        estoqueMb: Math.max(0, numero(sim.estoqueMb, 0)),
        atribuidas: 0
    }))
    const atribuicoes = []

    const reservasGlobais = aplicarReservasGlobais(sims, capacidade.reservasGlobais)
    if (!reservasGlobais.ok) return reservasGlobais

    let reservaSemSlot = Math.max(0, Number(capacidade.ativosSemSlot) || 0)
    while (reservaSemSlot > 0) {
        const candidato = sims
            .filter(sim => !sim.bloqueado && sim.restantes > 0)
            .sort((a, b) => b.restantes - a.restantes || b.estoqueMb - a.estoqueMb || a.slot - b.slot)[0]
        if (!candidato) {
            return { ok: false, motivo: 'sem-capacidade', erro: 'Os chips não têm capacidade diária disponível.' }
        }
        candidato.restantes -= 1
        reservaSemSlot -= 1
    }

    let reservaEstoque = Math.max(0, Number(capacidade.estoqueReservadoSemSlot) || 0)
    while (reservaEstoque > 0) {
        const candidato = sims
            .filter(sim => sim.estoqueMb > 0)
            .sort((a, b) => b.estoqueMb - a.estoqueMb || a.slot - b.slot)[0]
        if (!candidato) {
            return { ok: false, motivo: 'sem-estoque', erro: 'Estoque de megas insuficiente para os pedidos em fila.' }
        }
        const consumo = Math.min(candidato.estoqueMb, reservaEstoque)
        candidato.estoqueMb -= consumo
        reservaEstoque -= consumo
    }

    for (const parte of lista) {
        const candidatos = sims
            .filter(sim => !sim.bloqueado && sim.restantes > 0 && sim.estoqueMb > 0)
            .sort((a, b) => b.restantes - a.restantes || b.estoqueMb - a.estoqueMb || a.slot - b.slot)

        if (candidatos.length === 0) {
            return { ok: false, motivo: 'sem-capacidade', erro: 'Os chips não têm capacidade diária disponível.' }
        }

        let escolhido = null

        for (const candidato of candidatos) {
            if (candidato.estoqueMb >= parte) {
                escolhido = candidato
                break
            }
        }

        if (!escolhido) {
            return {
                ok: false,
                motivo: 'sem-estoque',
                erro: `Estoque de megas insuficiente para enviar ${parte}MB.`
            }
        }

        escolhido.restantes -= 1
        escolhido.estoqueMb -= parte
        escolhido.atribuidas += 1

        atribuicoes.push({
            dispositivoId: escolhido.dispositivoId || escolhido.deviceId || null,
            deviceId: escolhido.dispositivoId || escolhido.deviceId || null,
            slot: escolhido.slot,
            simNome: escolhido.nome,
            mb: parte,
            mbEnvio: parte,
            indiceNaSim: escolhido.usado + escolhido.ativos + escolhido.atribuidas - 1
        })
    }

    return { ok: true, atribuicoes }
}

module.exports = {
    HEARTBEAT_MAX_MS,
    PAPEIS_MB,
    obterCapacidadeSims,
    montarCapacidade,
    distribuirPartes,
    listarDispositivos,
    selecionarDispositivo,
    resumoAtivos,
    ativosPorSlot
}

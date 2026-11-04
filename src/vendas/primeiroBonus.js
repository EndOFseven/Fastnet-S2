const { primeiroBonusStore } = require('../utils/firebaseDataLayer')
const { getHojeMocambique } = require('../utils/timezone')

const BONUS_MB = 100
const VALOR_MINIMO = 10
const RESERVA_TTL_MS = 10 * 60 * 1000
const reservas = new Map()

function carregarDados() {
    const dados = primeiroBonusStore.loadSync() || {}
    if (!dados.configs || typeof dados.configs !== 'object') dados.configs = {}
    if (!dados.grupos || typeof dados.grupos !== 'object') dados.grupos = {}
    return dados
}

function chaveReserva(groupId, dia) {
    return `${groupId}|${dia}`
}

function limparReservasAntigas() {
    const agora = Date.now()
    for (const [chave, reserva] of reservas.entries()) {
        if (!reserva || (agora - (reserva.reservadoEm || 0)) > RESERVA_TTL_MS) {
            reservas.delete(chave)
        }
    }
}

function isPrimeiroBonusAtivo(groupId) {
    if (!groupId) return false
    const dados = carregarDados()
    return dados.configs[groupId]?.ativo === true
}

function setPrimeiroBonusAtivo(groupId, ativo) {
    if (!groupId) return false
    const dados = carregarDados()
    dados.configs[groupId] = {
        ...(dados.configs[groupId] || {}),
        ativo: !!ativo,
        atualizadoEm: new Date().toISOString()
    }
    primeiroBonusStore.save(dados, true)
    return true
}

function getVezesPrimeiro(groupId, clienteId) {
    if (!groupId || !clienteId) return 0
    const dados = carregarDados()
    return Number(dados.grupos[groupId]?.sequencias?.[clienteId]?.vezes) || 0
}

function getEstadoHoje(groupId) {
    const hoje = getHojeMocambique()
    const dados = carregarDados()
    const grupo = dados.grupos[groupId] || {}
    const vencedor = grupo.dia === hoje && grupo.vencedor ? grupo.vencedor : null
    return {
        ativo: isPrimeiroBonusAtivo(groupId),
        dia: hoje,
        vencedor,
        vezesPrimeiro: vencedor?.clienteId ? getVezesPrimeiro(groupId, vencedor.clienteId) : 0
    }
}

function valorElegivel(valor) {
    return (Number(valor) || 0) >= VALOR_MINIMO
}

function isPacoteDiario(tipoPacote) {
    return /di[aá]ri|24\s*h|atualiz/i.test(String(tipoPacote || ''))
}

function reservarPrimeiroBonus({ groupId, clienteId, clienteNome, codigo, valor, tipoPacote, isSaldo }) {
    limparReservasAntigas()
    if (!groupId || !clienteId) return { ganhou: false, motivo: 'dados-invalidos' }
    if (!isPrimeiroBonusAtivo(groupId)) return { ganhou: false, motivo: 'inativo' }
    if (isSaldo || /saldo/i.test(String(tipoPacote || ''))) return { ganhou: false, motivo: 'saldo' }
    if (!isPacoteDiario(tipoPacote)) return { ganhou: false, motivo: 'nao-diario' }
    if (!valorElegivel(valor)) return { ganhou: false, motivo: 'valor-menor-10' }

    const hoje = getHojeMocambique()
    const dados = carregarDados()
    const grupo = dados.grupos[groupId] || {}
    const vencedor = grupo.dia === hoje && grupo.vencedor ? grupo.vencedor : null

    if (vencedor) {
        return {
            ganhou: false,
            motivo: vencedor.codigo && vencedor.codigo === codigo ? 'ja-processado' : 'ja-existe-vencedor',
            vencedor
        }
    }

    const chave = chaveReserva(groupId, hoje)
    const existente = reservas.get(chave)
    if (existente) {
        return {
            ganhou: false,
            motivo: existente.codigo && existente.codigo === codigo ? 'ja-reservado' : 'reservado',
            vencedor: existente
        }
    }

    const reserva = {
        groupId,
        dia: hoje,
        clienteId,
        clienteNome: clienteNome || '',
        codigo: codigo || '',
        valor: Number(valor) || 0,
        tipoPacote: tipoPacote || '',
        bonusMb: BONUS_MB,
        vezesPrimeiro: getVezesPrimeiro(groupId, clienteId) + 1,
        reservadoEm: Date.now()
    }

    reservas.set(chave, reserva)
    return { ganhou: true, ...reserva }
}

function confirmarPrimeiroBonus(reserva) {
    if (!reserva || !reserva.ganhou || !reserva.groupId || !reserva.clienteId) {
        return { ok: false }
    }

    const dados = carregarDados()
    const grupo = dados.grupos[reserva.groupId] || {}
    const dia = reserva.dia || getHojeMocambique()
    const existente = grupo.dia === dia && grupo.vencedor ? grupo.vencedor : null

    if (existente && existente.codigo && reserva.codigo && existente.codigo !== reserva.codigo) {
        return { ok: false, motivo: 'ja-existe-vencedor' }
    }

    const sequencias = grupo.sequencias || {}
    const anterior = sequencias[reserva.clienteId] || { vezes: 0 }
    sequencias[reserva.clienteId] = {
        ...anterior,
        nome: reserva.clienteNome || anterior.nome || '',
        vezes: Math.max(Number(anterior.vezes) || 0, Number(reserva.vezesPrimeiro) || 0),
        ultimaVez: dia
    }

    grupo.dia = dia
    grupo.sequencias = sequencias
    grupo.vencedor = {
        clienteId: reserva.clienteId,
        clienteNome: reserva.clienteNome || '',
        codigo: reserva.codigo || '',
        valor: Number(reserva.valor) || 0,
        tipoPacote: reserva.tipoPacote || '',
        pacoteBaseMb: Number(reserva.pacoteBaseMb) || 0,
        pacoteTotalMb: Number(reserva.pacoteTotalMb) || 0,
        bonusMb: BONUS_MB,
        vezesPrimeiro: Number(reserva.vezesPrimeiro) || 0,
        status: 'CONFIRMADO',
        confirmadoEm: new Date().toISOString()
    }

    dados.grupos[reserva.groupId] = grupo
    primeiroBonusStore.save(dados, true)
    reservas.delete(chaveReserva(reserva.groupId, dia))
    return { ok: true, vezesPrimeiro: grupo.vencedor.vezesPrimeiro }
}

function liberarPrimeiroBonus(reserva) {
    if (!reserva || !reserva.groupId) return false
    const dia = reserva.dia || getHojeMocambique()
    reservas.delete(chaveReserva(reserva.groupId, dia))
    return true
}

function formatarVolume(mb) {
    const valor = Number(mb) || 0
    if (valor >= 1024) {
        const gb = valor / 1024
        return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`
    }
    return `${Math.round(valor)} MB`
}

function formatarPacoteComBonus(baseMb, bonusMb) {
    const base = Number(baseMb) || 0
    const bonus = Number(bonusMb) || 0
    return `${formatarVolume(base + bonus)} (${formatarVolume(base)} + ${bonus}MB Bônus 1º do Dia)`
}

function montarMensagemBonus(bonus) {
    if (!bonus || !bonus.aplicado) return []
    const linhas = [
        '🎉 *BÔNUS 1º COMPRADOR DO DIA! (+100MB)*',
        `📦 Total a enviar: *${formatarVolume(bonus.itemMb)}*`
    ]
    if ((Number(bonus.vezesPrimeiro) || 0) > 1) {
        linhas.push(`🔥 Sequência: ${bonus.vezesPrimeiro}ª vez a ser o primeiro do grupo a comprar MB!`)
    }
    return linhas
}

module.exports = {
    BONUS_MB,
    VALOR_MINIMO,
    isPrimeiroBonusAtivo,
    setPrimeiroBonusAtivo,
    getEstadoHoje,
    getVezesPrimeiro,
    valorElegivel,
    isPacoteDiario,
    reservarPrimeiroBonus,
    confirmarPrimeiroBonus,
    liberarPrimeiroBonus,
    formatarVolume,
    formatarPacoteComBonus,
    montarMensagemBonus
}

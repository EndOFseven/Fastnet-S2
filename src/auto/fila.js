const fs = require('fs')
const path = require('path')
const { putFirebase, patchFirebase, fetchFirebase } = require('../utils/firebaseConfig')

const ARQUIVO = path.join(__dirname, '../../data/pedidosAuto.json')
const STATUS_ATIVOS = ['PENDENTE', 'PROCESSANDO']
const STATUS_FINAIS = ['SUCESSO', 'CONCLUIDO', 'FALHA', 'CANCELADO', 'EXPIRADO', 'DESAPARECIDO']

function carregarPedidos() {
    try {
        const bruto = fs.readFileSync(ARQUIVO, 'utf8')
        const dados = JSON.parse(bruto)
        return dados && typeof dados === 'object' ? dados : {}
    } catch {
        return {}
    }
}

function salvarPedidos(pedidos) {
    try {
        fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true })
        const tmp = ARQUIVO + '.tmp'
        fs.writeFileSync(tmp, JSON.stringify(pedidos, null, 2))
        fs.renameSync(tmp, ARQUIVO)
        return true
    } catch (err) {
        console.error('[AUTO-FILA] Erro ao salvar pedidos:', err.message)
        return false
    }
}

function normalizarTelefone(raw) {
    const digitos = String(raw || '').replace(/\D/g, '')
    if (/^2588[45]\d{7}$/.test(digitos)) return digitos.slice(3)
    if (/^8[45]\d{7}$/.test(digitos)) return digitos
    return ''
}

function gerarIdPedido() {
    const base = Date.now().toString(36).toUpperCase()
    const aleatorio = Math.random().toString(36).slice(2, 5).toUpperCase()
    return `WA-${base}${aleatorio}`
}

async function enfileirar(dados) {
    const centralCode = String(dados.centralCode || '').trim().toUpperCase()
    if (!centralCode) return { ok: false, motivo: 'Grupo sem servidor vinculado. Use o comando de vínculo primeiro.' }

    const telefone = normalizarTelefone(dados.clientePhone)
    if (!telefone) return { ok: false, motivo: 'Número inválido. Use um número moçambicano, ex.: 845123456.' }

    const isSaldo = dados.isSaldo === true
    let megasAmount = Math.max(0, parseInt(dados.megasAmount, 10) || 0)
    let saldoAmount = Math.max(0, parseInt(dados.saldoAmount, 10) || 0)
    if (isSaldo && saldoAmount <= 0 && megasAmount > 0) saldoAmount = megasAmount
    if (isSaldo && megasAmount <= 0 && saldoAmount > 0) megasAmount = saldoAmount
    if (!isSaldo && megasAmount <= 0) return { ok: false, motivo: 'Pacote de megas inválido.' }

    const id = gerarIdPedido()
    const agora = Date.now()
    const pedido = {
        id,
        status: 'PENDENTE',
        clientePhone: telefone,
        megasAmount,
        valorPago: Number(dados.valorPago) || 0,
        valor: Number(dados.valorPago) || 0,
        ussdMethod: dados.ussdMethod || (isSaldo ? '*111#' : '*162#'),
        isManual: false,
        isSaldo,
        tipoPacote: dados.tipoPacote || (isSaldo ? 'Saldo' : ''),
        packageCategory: dados.packageCategory || (isSaldo ? 'SALDO' : ''),
        packageOption: dados.packageOption || '',
        repeticoes: Math.max(1, parseInt(dados.repeticoes, 10) || 1),
        centralCode,
        origem: 'WHATSAPP_AUTO',
        grupoId: dados.grupoId || '',
        solicitadoPor: dados.solicitadoPor || '',
        referenciaRecibo: dados.referenciaRecibo || '',
        clienteNome: dados.clienteNome || '',
        createdAt: agora
    }
    if (isSaldo) pedido.saldoAmount = saldoAmount
    if (Number.isInteger(dados.targetSimSlot)) {
        pedido.targetSimSlot = dados.targetSimSlot
        pedido.simSlot = dados.targetSimSlot
        pedido.simName = dados.targetSimSlot === 0 ? 'SIM 1' : 'SIM 2'
    } else if (dados.simName) {
        pedido.simName = dados.simName
    }

    const enviado = await putFirebase(`device_pairings/${centralCode}/vendas_pendentes/${id}`, pedido)
    if (!enviado) {
        return { ok: false, motivo: 'Não foi possível enviar o pedido para o Firebase. Verifique a internet do servidor.' }
    }

    const pedidos = carregarPedidos()
    pedidos[id] = {
        id,
        centralCode,
        grupoId: pedido.grupoId,
        clientePhone: telefone,
        megasAmount,
        saldoAmount: isSaldo ? saldoAmount : 0,
        valorPago: pedido.valorPago,
        targetSimSlot: pedido.targetSimSlot !== undefined ? pedido.targetSimSlot : null,
        simSlot: pedido.simSlot !== undefined ? pedido.simSlot : null,
        simName: pedido.simName || null,
        status: 'PENDENTE',
        statusRemoto: 'PENDENTE',
        isSaldo,
        referenciaRecibo: pedido.referenciaRecibo,
        criadoEm: agora,
        atualizadoEm: agora,
        notificacoes: {}
    }
    salvarPedidos(pedidos)
    return { ok: true, pedido: pedidos[id] }
}

function listarPorGrupo(grupoId, incluirFinalizados = false) {
    const pedidos = carregarPedidos()
    const lista = Object.values(pedidos).filter(p => p.grupoId === grupoId)
    const filtrados = incluirFinalizados
        ? lista
        : lista.filter(p => STATUS_ATIVOS.includes(p.status))
    return filtrados.sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0))
}

function listarAtivos() {
    const pedidos = carregarPedidos()
    return Object.values(pedidos).filter(p => STATUS_ATIVOS.includes(p.status))
}

function listarTodos() {
    return Object.values(carregarPedidos())
}

function buscarPorId(id) {
    if (!id) return null
    return carregarPedidos()[String(id).trim().toUpperCase()] || null
}

function atualizarPedido(id, mudancas) {
    const pedidos = carregarPedidos()
    if (!pedidos[id]) return null
    pedidos[id] = { ...pedidos[id], ...mudancas, atualizadoEm: Date.now() }
    salvarPedidos(pedidos)
    return pedidos[id]
}

function marcarNotificado(id, chave) {
    const pedidos = carregarPedidos()
    const pedido = pedidos[id]
    if (!pedido) return
    pedido.notificacoes = pedido.notificacoes || {}
    pedido.notificacoes[chave] = true
    salvarPedidos(pedidos)
}

function limparFinalizados(grupoId) {
    const pedidos = carregarPedidos()
    let removidos = 0
    for (const id of Object.keys(pedidos)) {
        const pedido = pedidos[id]
        if (pedido.grupoId !== grupoId) continue
        if (STATUS_FINAIS.includes(pedido.status)) {
            delete pedidos[id]
            removidos++
        }
    }
    if (removidos > 0) salvarPedidos(pedidos)
    return removidos
}

async function consultarRemoto(centralCode, id) {
    return fetchFirebase(`device_pairings/${centralCode}/vendas_pendentes/${id}`)
}

async function cancelar(id, solicitadoPor) {
    const pedido = buscarPorId(id)
    if (!pedido) return { ok: false, motivo: 'Pedido não encontrado.' }
    if (!STATUS_ATIVOS.includes(pedido.status)) return { ok: false, motivo: `Este pedido já está ${pedido.status}.` }

    const ok = await patchFirebase(`device_pairings/${pedido.centralCode}/vendas_pendentes/${pedido.id}`, {
        status: 'CANCELADO',
        motivoErro: 'Cancelado pelo WhatsApp',
        canceladoPor: solicitadoPor || 'WHATSAPP',
        processedAt: Date.now()
    })
    if (!ok) return { ok: false, motivo: 'Não foi possível cancelar no Firebase. Tente novamente.' }

    atualizarPedido(pedido.id, { status: 'CANCELADO', statusRemoto: 'CANCELADO' })
    return { ok: true, pedido }
}

module.exports = {
    STATUS_ATIVOS,
    STATUS_FINAIS,
    normalizarTelefone,
    enfileirar,
    listarPorGrupo,
    listarAtivos,
    listarTodos,
    buscarPorId,
    atualizarPedido,
    marcarNotificado,
    limparFinalizados,
    consultarRemoto,
    cancelar
}

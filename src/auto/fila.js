const fs = require('fs')
const path = require('path')
const { putFirebase, patchFirebase, fetchFirebase } = require('../utils/firebaseConfig')

const ARQUIVO = path.join(__dirname, '../../data/pedidosAuto.json')
const ARQUIVO_CONTADOR = path.join(__dirname, '../../data/contadorPedidos.json')
const STATUS_ATIVOS = ['PENDENTE', 'PROCESSANDO']
const STATUS_FINAIS = ['SUCESSO', 'CONCLUIDO', 'FALHA', 'CANCELADO', 'EXPIRADO', 'DESAPARECIDO']

function carregarContador() {
    try {
        const bruto = fs.readFileSync(ARQUIVO_CONTADOR, 'utf8')
        const dados = JSON.parse(bruto)
        return Number(dados?.ultimoNumero) || 0
    } catch {
        return 0
    }
}

function salvarContador(num) {
    try {
        fs.mkdirSync(path.dirname(ARQUIVO_CONTADOR), { recursive: true })
        fs.writeFileSync(ARQUIVO_CONTADOR, JSON.stringify({
            ultimoNumero: num,
            atualizadoEm: new Date().toISOString()
        }, null, 2))
    } catch (err) {
        console.error('[CONTADOR] Erro ao salvar contador local:', err.message)
    }
}

let contadorMemoria = null

async function obterProximoNumeroPedido(centralCode) {
    if (contadorMemoria === null) {
        let n = carregarContador()
        if (n === 0 && centralCode) {
            try {
                const fb = await fetchFirebase(`device_pairings/${centralCode}/contador_pedidos/ultimoNumero`)
                if (Number(fb) > 0) n = Number(fb)
            } catch {}
        }
        contadorMemoria = n
    }

    contadorMemoria += 1
    const proximo = contadorMemoria
    salvarContador(proximo)

    if (centralCode) {
        patchFirebase(`device_pairings/${centralCode}/contador_pedidos`, {
            ultimoNumero: proximo,
            atualizadoEm: new Date().toISOString()
        }).catch(() => {})
    }

    return proximo
}

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

    const numero = await obterProximoNumeroPedido(centralCode)
    const id = `PED-${numero}`
    const agora = Date.now()
    const pedido = {
        id,
        numero,
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
        bonusMb: Math.max(0, parseInt(dados.bonusMb, 10) || 0),
        pacoteBaseMb: Math.max(0, parseInt(dados.pacoteBaseMb, 10) || 0),
        displayPacote: dados.displayPacote || '',
        bonusLabel: dados.bonusLabel || '',
        registrarNoMonitor: dados.registrarNoMonitor !== false,
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
        numero,
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
        bonusMb: pedido.bonusMb,
        pacoteBaseMb: pedido.pacoteBaseMb,
        displayPacote: pedido.displayPacote,
        bonusLabel: pedido.bonusLabel,
        registrarNoMonitor: pedido.registrarNoMonitor,
        criadoEm: agora,
        atualizadoEm: agora,
        notificacoes: {},
        msgKey: dados.msgKey || null,
        msgId: dados.msgKey?.id || null
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
    const pedidos = carregarPedidos()
    const chave = String(id).trim().toUpperCase()
    if (pedidos[chave]) return pedidos[chave]
    if (pedidos[`PED-${chave}`]) return pedidos[`PED-${chave}`]
    const num = chave.replace(/^[#PEDIDO\-_ ]+/i, '').trim()
    if (num && pedidos[`PED-${num}`]) return pedidos[`PED-${num}`]
    for (const p of Object.values(pedidos)) {
        if (!p) continue
        if (p.id === chave || p.id === `PED-${chave}`) return p
        if (num && (String(p.numero) === num || p.id === `PED-${num}`)) return p
    }
    return null
}

function atualizarPedido(id, mudancas) {
    const pedidos = carregarPedidos()
    let pedido = pedidos[id]
    if (!pedido) pedido = buscarPorId(id)
    if (!pedido || !pedido.id) return null
    const realId = pedido.id
    pedidos[realId] = { ...pedidos[realId], ...mudancas, atualizadoEm: Date.now() }
    salvarPedidos(pedidos)
    return pedidos[realId]
}

function marcarNotificado(id, chave) {
    const pedidos = carregarPedidos()
    let pedido = pedidos[id]
    if (!pedido) pedido = buscarPorId(id)
    if (!pedido || !pedido.id) return
    const realId = pedido.id
    pedidos[realId].notificacoes = pedidos[realId].notificacoes || {}
    pedidos[realId].notificacoes[chave] = true
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

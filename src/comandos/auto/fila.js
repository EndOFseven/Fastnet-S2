const config = require('../../../data/config.json')
const { isAdmin, isOwnerCheck } = require('../../utils/baileys')
const { listarPorGrupo, limparFinalizados, cancelar } = require('../../auto/fila')

const ICONES = {
    PENDENTE: '⏳',
    PROCESSANDO: '⚡',
    SUCESSO: '✅',
    CONCLUIDO: '✅',
    FALHA: '❌',
    CANCELADO: '🚫',
    EXPIRADO: '⚠️',
    DESAPARECIDO: '⚠️'
}

function formatarPacote(pedido) {
    const mb = Number(pedido.megasAmount) || 0
    if (pedido.isSaldo) return `Saldo ${pedido.saldoAmount || mb} MT`
    if (mb >= 1024) return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1).replace('.', ',')} GB`
    return `${Math.floor(mb)} MB`
}

function formatarHora(ts) {
    try {
        const d = new Date(ts)
        const dd = String(d.getDate()).padStart(2, '0')
        const mm = String(d.getMonth() + 1).padStart(2, '0')
        const hh = String(d.getHours()).padStart(2, '0')
        const mi = String(d.getMinutes()).padStart(2, '0')
        return `${dd}/${mm} ${hh}:${mi}`
    } catch {
        return '--'
    }
}

function linhaPedido(pedido) {
    const icone = ICONES[pedido.status] || '•'
    return `${icone} *${pedido.id}* • ${pedido.clientePhone} • ${formatarPacote(pedido)} • ${pedido.status} • ${formatarHora(pedido.criadoEm)}`
}

async function filaHandler(sock, msg, from, sender, text) {
    const prefix = config.prefix || '.'
    const partes = String(text || '').trim().split(/\s+/)
    const cmd = (partes[0] || '').toLowerCase()
    const nomes = [prefix + 'fila', prefix + 'pedidosauto', prefix + 'pedidos']
    if (!nomes.includes(cmd)) return false

    if (!from.endsWith('@g.us')) {
        await sock.sendMessage(from, { text: '❌ Esse comando só funciona em grupos.' }, { quoted: msg })
        return true
    }

    let isAdm = false
    try { isAdm = await isAdmin(sock, from, sender) } catch {}
    if (!isOwnerCheck(sender, msg) && !isAdm) {
        await sock.sendMessage(from, { text: '❌ Só administradores do grupo ou o Dono do bot podem ver a fila automática.' }, { quoted: msg })
        return true
    }

    const acao = (partes[1] || '').toLowerCase()

    if (acao === 'ajuda' || acao === 'help') {
        await sock.sendMessage(from, {
            text: [
                '📋 *FILA DE ENVIOS* ',
                '',
                `📋 ${prefix}fila`,
                `📚 ${prefix}fila todas`,
                `🚫 ${prefix}fila cancelar <id>`,
                `🗑️ ${prefix}fila limpar`,
                '──────────────────'
            ].join('\n')
        }, { quoted: msg })
        return true
    }

    if (acao === 'limpar') {
        const removidos = limparFinalizados(from)
        await sock.sendMessage(from, { text: `🗑️ ${removidos} pedido(s) concluído(s) apagado(s) da fila local.` }, { quoted: msg })
        return true
    }

    if (acao === 'cancelar') {
        const id = (partes[2] || '').toUpperCase()
        if (!id) {
            await sock.sendMessage(from, { text: `ℹ️ Formato: *${prefix}fila cancelar <id do pedido>*` }, { quoted: msg })
            return true
        }
        const resultado = await cancelar(id, sender)
        if (!resultado.ok) {
            await sock.sendMessage(from, { text: `❌ ${resultado.motivo}` }, { quoted: msg })
            return true
        }
        await sock.sendMessage(from, { text: `🚫 Pedido *${id}* foi cancelado.` }, { quoted: msg })
        try { await sock.sendMessage(from, { react: { text: '🚫', key: msg.key } }) } catch {}
        return true
    }

    const incluirFinalizados = acao === 'todas' || acao === 'todos' || acao === 'historico'
    const pedidos = listarPorGrupo(from, incluirFinalizados).slice(0, 15)

    if (pedidos.length === 0) {
        await sock.sendMessage(from, {
            text: incluirFinalizados
                ? 'ℹ️ Este grupo ainda não tem pedidos automáticos.'
                : 'ℹ️ Nenhum pedido em andamento.\n\nUse *' + prefix + 'fila todas* para abrir o histórico.'
        }, { quoted: msg })
        return true
    }

    const titulo = incluirFinalizados ? 'PEDIDOS ANTERIORES' : 'PEDIDOS ATIVOS'
    const linhas = pedidos.map(linhaPedido)
    const texto = [
        `📋 *${titulo}* `,
        '',
        ...linhas,
        '',
        `_Exibindo ${pedidos.length} pedido(s)._`,
        '──────────────────'
    ].join('\n')

    await sock.sendMessage(from, { text: texto }, { quoted: msg })
    return true
}

filaHandler.nome = 'fila'
filaHandler.name = 'fila'
filaHandler.aliases = ['pedidosauto', 'pedidos']
filaHandler.categoria = 'auto'
filaHandler.subcategoria = 'AUTOMAÇÃO'
filaHandler.descricao = 'Consulta e gerencia os pedidos automáticos deste grupo'
filaHandler.uso = `${config.prefix}fila [todas|limpar|cancelar]`
filaHandler.apenasAdmin = true

module.exports = filaHandler

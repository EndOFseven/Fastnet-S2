const config = require('../../../data/config.json')
const { isAdmin: checkIsAdmin, isOwnerCheck } = require('../../utils/baileys.js')
const verificacao = require('../../vendas/verificacao')
const { aprovarPendente } = require('../../vendas/aprovacao')

function numeroVisivel(jid) {
    return String(jid || '').split('@')[0].split(':')[0]
}

module.exports = async (sock, msg, from, sender, text) => {
    const prefix = config.prefix || '.'
    if (!String(text || '').startsWith(prefix + 'confirmar')) return false

    const reply = (texto) => sock.sendMessage(from, { text: texto }, { quoted: msg })

    if (!from.endsWith('@g.us')) {
        await reply('❌ Este comando funciona apenas em grupos!')
        return true
    }

    const isOwner = isOwnerCheck(sender, msg)
    let isAdmin = false
    try {
        if (!isOwner) isAdmin = await checkIsAdmin(sock, from, sender)
    } catch { }

    if (!isAdmin && !isOwner) {
        await reply('❌ Apenas administradores podem confirmar comprovativos!')
        return true
    }

    const args = String(text).trim().split(/\s+/)
    let codigo = args[1] || null

    if (!codigo) {
        const ctx = msg.message?.extendedTextMessage?.contextInfo
            || msg.message?.imageMessage?.contextInfo
            || msg.message?.documentMessage?.contextInfo
            || null
        const quoted = ctx?.quotedMessage || null
        const quotedText = quoted
            ? (quoted.conversation || quoted.extendedTextMessage?.text || quoted.imageMessage?.caption || quoted.documentMessage?.caption || '')
            : ''
        const quotedSender = ctx?.participant || ''

        const mRef = quotedText.match(/(?:Confirmado|ID da transacao|ID\s*Trans|Transaction ID|TxID|Refer[eê]ncia|Recibo|C[oó]digo|Ref|ID|Tx)[\s:*#]+([A-Za-z0-9.]{6,30})/i)
        const mTick = quotedText.match(/`([A-Za-z0-9][A-Za-z0-9.\-]{5,})`/)
        codigo = (mRef?.[1] || mTick?.[1] || '').replace(/[*_~`]/g, '').replace(/^\.+|\.+$/g, '').trim().toUpperCase() || null

        if (!codigo && quotedSender) {
            const alvo = numeroVisivel(quotedSender)
            const doCliente = verificacao.listarPendentes(from)
                .filter(p => numeroVisivel(p.clienteId) === alvo || numeroVisivel(p.cliente) === alvo)
            if (doCliente.length === 1) {
                codigo = doCliente[0].codigo
            } else if (doCliente.length > 1) {
                await reply([
                    '⚠️ *VÁRIOS COMPROVATIVOS DESTE CLIENTE*',
                    '──────────────────',
                    ...doCliente.slice(0, 5).map(p => `▸ \`${p.codigo}\` • ${p.valor} MT`),
                    '──────────────────',
                    `Use \`${prefix}confirmar CÓDIGO\`.`
                ].join('\n'))
                return true
            }
        }

        if (!codigo && (quotedText || quotedSender)) {
            await reply(`⚠️ Não encontrei comprovativo na mensagem respondida.\nUse \`${prefix}confirmar CÓDIGO\` (veja os pendentes com \`${prefix}confirmar\`).`)
            return true
        }
    }

    if (!codigo) {
        const pendentes = verificacao.listarPendentes(from)
        if (pendentes.length === 0) {
            await reply('✅ *SEM PENDENTES*\n──────────────────\n▸ Nenhum comprovativo aguarda confirmação neste grupo.')
            return true
        }
        const linhas = pendentes.slice(0, 10).map(p => {
            const origem = p.status === 'AGUARDANDO_SMS' ? 'SMS oficial' : 'manual'
            return `▸ \`${p.codigo}\` • ${p.valor} MT • @${numeroVisivel(p.clienteId)} • ${origem}`
        })
        await reply([
            '⏳ *COMPROVATIVOS PENDENTES*',
            '──────────────────',
            ...linhas,
            '──────────────────',
            `✅ \`${prefix}confirmar CÓDIGO\` _(forçar aprovação)_`,
            `❌ \`${prefix}recusar CÓDIGO\` _(rejeitar comprovativo)_`
        ].join('\n'))
        return true
    }

    const pendente = verificacao.buscarPendente(from, codigo)
    if (!pendente) {
        await reply(`⚠️ *NÃO ENCONTRADO*\n──────────────────\n▸ Não existe comprovativo pendente com o código *${codigo}* neste grupo.\n▸ Verifique os pendentes com \`${prefix}confirmar\`.`)
        return true
    }

    await aprovarPendente(sock, pendente, {
        origemLabel: `confirmação manual de @${numeroVisivel(sender)}`,
        por: 'admin-confirmado',
        porJid: sender
    })

    return true
}

module.exports.nome = 'confirmar'
module.exports.aliases = ['aprovcomprovante', 'confirmarcomprovante']
module.exports.categoria = 'adm'
module.exports.subcategoria = 'VENDAS & COMPROVANTES'
module.exports.descricao = 'Força manualmente a aprovação de um comprovativo em conferência'
module.exports.uso = '.confirmar [código] · ou responda à mensagem do cliente com .confirmar'

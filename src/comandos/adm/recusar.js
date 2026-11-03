const config = require('../../../data/config.json')
const { isAdmin: checkIsAdmin, isOwnerCheck } = require('../../utils/baileys.js')
const verificacao = require('../../vendas/verificacao')
const { recusarPendente } = require('../../vendas/aprovacao')
const { reciboJaUsado, marcarReciboUsado } = require('../../vendas/recibos')
const { marcarUtilizado, limparEspera } = require('../../vendas/comprovantesOficiais')

function numeroVisivel(jid) {
    return String(jid || '').split('@')[0].split(':')[0]
}

function resolverCentralCode(from) {
    try {
        const configManager = require('../../utils/configManager')
        const groups = configManager.loadGroupConfig()
        const chave = (id) => groups[id] || groups[id.replace(/\./g, '___dot___')] || groups[id.replace(/___dot___/g, '.')] || {}
        return chave(from).centralCode || 'S2-510281'
    } catch {
        return 'S2-510281'
    }
}

module.exports = async (sock, msg, from, sender, text) => {
    const prefix = config.prefix || '.'
    if (!String(text || '').startsWith(prefix + 'recusar')) return false

    const reply = (texto, opts = {}) => sock.sendMessage(from, { text: texto, ...opts }, { quoted: msg })

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
        await reply('❌ Apenas administradores podem recusar comprovativos!')
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

        if (!codigo && quotedText) {
            const raw = quotedText.replace(/[*_~`]/g, '').trim()
            if (/^[A-Za-z0-9.]{6,30}$/.test(raw)) {
                codigo = raw.toUpperCase()
            }
        }

        if (!codigo && quotedSender) {
            const alvo = numeroVisivel(quotedSender)
            const doCliente = verificacao.listarPendentes(from)
                .filter(p => numeroVisivel(p.clienteId) === alvo || numeroVisivel(p.cliente) === alvo)
            if (doCliente.length === 1) {
                codigo = doCliente[0].codigo
            }
        }
    }

    if (!codigo) {
        const pendentes = verificacao.listarPendentes(from)
        if (pendentes.length > 0) {
            const lista = pendentes.slice(0, 5).map(p => `▸ \`${p.codigo}\` • ${p.valor} MT (@${numeroVisivel(p.clienteId)})`).join('\n')
            await reply([
                '⚠️ *CÓDIGO EM FALTA*',
                '──────────────────',
                `▸ Uso: \`${prefix}recusar CÓDIGO\``,
                `▸ Ou responda ao comprovativo com \`${prefix}recusar\``,
                '',
                '*Comprovativos pendentes neste grupo:*',
                lista,
                '──────────────────',
                `💡 *Dica:* Para queimar antecipadamente um código já atendido por fora (ex: via \`${prefix}enviarauto\`), digite: \`${prefix}recusar CÓDIGO\`.`
            ].join('\n'))
        } else {
            await reply([
                '⚠️ *CÓDIGO EM FALTA*',
                '──────────────────',
                `▸ Uso: \`${prefix}recusar CÓDIGO\``,
                `▸ Ou responda ao comprovativo com \`${prefix}recusar\``,
                '',
                '💡 *Bloqueio Antecipado:*',
                `Pode queimar qualquer código de comprovativo (ex: atendido manualmente ou via \`${prefix}enviarauto\`) digitando \`${prefix}recusar CÓDIGO\`. O sistema marcará como utilizado para evitar que o cliente reutilize no grupo!`
            ].join('\n'))
        }
        return true
    }

    codigo = codigo.replace(/[*_~`]/g, '').replace(/^\.+|\.+$/g, '').trim().toUpperCase()
    const cleanAlnum = codigo.replace(/[^A-Z0-9]/g, '')
    if (cleanAlnum.length < 6) {
        await reply(`⚠️ *CÓDIGO INVÁLIDO*\n──────────────────\n▸ O código *${codigo}* é muito curto ou inválido (mínimo de 6 caracteres alfanuméricos).`)
        return true
    }

    // 1. Se o comprovativo estiver pendente de confirmação no grupo, recusa normalmente
    const pendente = verificacao.buscarPendente(from, codigo)
    if (pendente) {
        await recusarPendente(sock, pendente, {
            motivo: 'recusado_pelo_admin',
            porJid: sender
        })
        return true
    }

    // 2. Se não estiver na fila de pendentes: verificar se já está bloqueado/usado
    if (reciboJaUsado(codigo)) {
        await reply([
            'ℹ️ *COMPROVATIVO JÁ BLOQUEADO*',
            '──────────────────',
            `📋 Código: \`${codigo}\``,
            '▸ Este comprovativo já se encontra registado e bloqueado no sistema.',
            '▸ Se o cliente tentar enviá-lo no grupo ou privado, o bot rejeitará automaticamente como já utilizado.'
        ].join('\n'))
        return true
    }

    // 3. Se não estava registado, queima antecipadamente no sistema local e no Firebase
    marcarReciboUsado(codigo, {
        por: 'admin_antecipado',
        recusadoPor: sender,
        motivo: 'bloqueio_manual_preventivo',
        bloqueadoEm: new Date().toISOString()
    })

    const centralCode = resolverCentralCode(from)
    if (centralCode) {
        await marcarUtilizado(codigo, centralCode, 'admin_antecipado').catch(() => {})
    }
    await limparEspera(codigo).catch(() => {})

    await reply([
        '🚫 *COMPROVATIVO BLOQUEADO PREVENTIVAMENTE*',
        '────────────────────────',
        `📋 *Código:* \`${codigo}\``,
        `👑 *Bloqueado por:* @${numeroVisivel(sender)}`,
        '🔒 *Estado:* Queimado / Inutilizado no sistema',
        '────────────────────────',
        '✅ *Proteção ativa:* Se o cliente tentar enviar este comprovativo no grupo ou no privado, o bot rejeitará imediatamente com o aviso: *"comprovativo já utilizado"*.'
    ].join('\n'), { mentions: [sender] })

    return true
}

module.exports.nome = 'recusar'
module.exports.aliases = ['recusarcomprovante', 'rejeitarcomprovante', 'bloquearrecibo', 'bloquearcomprovativo']
module.exports.categoria = 'adm'
module.exports.subcategoria = 'VENDAS & COMPROVANTES'
module.exports.descricao = 'Recusa um comprovativo pendente ou queima/bloqueia preventivamente um código para evitar reutilização'
module.exports.uso = '.recusar [código] (ou responda ao comprovativo)'

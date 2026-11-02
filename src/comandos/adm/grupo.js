const path = require('path')
const config = require(path.join(__dirname, '../../../data/config.json'))

const { isAdmin, isOwnerCheck, getGroupMetadataCached, invalidateGroupCache } = require('../../utils/baileys')

async function grupoEstaFechado(sock, from) {
    try {
        const metadata = await getGroupMetadataCached(sock, from)
        if (!metadata) return null
        return metadata.announce === true
    } catch (e) {
        return null
    }
}

module.exports = async (sock, msg, from, sender, text) => {

    if (!from.endsWith('@g.us')) return false

    const isOwner = isOwnerCheck(sender, msg)

    const adminStatus = await isAdmin(sock, from, sender)

    if (!isOwner && !adminStatus) return false

    const lowerText = text.toLowerCase().trim()
    const prefix = config.prefix

    const isAbrir = lowerText.startsWith(prefix + 'grupo a') || lowerText.startsWith(prefix + 'grupo abrir') || lowerText.startsWith(prefix + 'abrir')
    if (isAbrir) {
        let prefixUsado = prefix + 'grupo a'
        if (lowerText.startsWith(prefix + 'grupo abrir')) prefixUsado = prefix + 'grupo abrir'
        else if (lowerText.startsWith(prefix + 'abrir')) prefixUsado = prefix + 'abrir'

        const resto = text.slice(prefixUsado.length).trim().replace(/^[\s,:-]+/, '').trim()

        if (resto === 'off' || /^(\d{1,2}):(\d{2})$/.test(resto)) {
            return false
        }

        const motivo = resto

        const fechado = await grupoEstaFechado(sock, from)
        if (fechado === false) {
            await sock.sendMessage(from, {
                text: 'ℹ️ *GRUPO JÁ ABERTO*\n──────────────────\n▸ Todos já podem falar.'
            }, { quoted: msg })
            return true
        }

        try {
            await sock.groupSettingUpdate(from, 'not_announcement')
            invalidateGroupCache(from)
            const respostaText = motivo
                ? `🔓 *GRUPO ABERTO*\n──────────────────\n▸ 📌 *Motivo:* ${motivo}\n──────────────────\n▸ Todos já podem enviar mensagens.`
                : '🔓 *GRUPO ABERTO*\n──────────────────\n▸ Todos já podem enviar mensagens.'

            await sock.sendMessage(from, { text: respostaText }, { quoted: msg })
            return true
        } catch (err) {
            await sock.sendMessage(from, {
                text: '❌ *ERRO*\n──────────────────\n▸ Não foi possível abrir.\n▸ Confirme se o bot é admin.'
            }, { quoted: msg })
            return true
        }
    }

    const isFechar = lowerText.startsWith(prefix + 'grupo f') || lowerText.startsWith(prefix + 'grupo fechar') || lowerText.startsWith(prefix + 'fechar')
    if (isFechar) {
        let prefixUsado = prefix + 'grupo f'
        if (lowerText.startsWith(prefix + 'grupo fechar')) prefixUsado = prefix + 'grupo fechar'
        else if (lowerText.startsWith(prefix + 'fechar')) prefixUsado = prefix + 'fechar'

        const resto = text.slice(prefixUsado.length).trim().replace(/^[\s,:-]+/, '').trim()

        if (resto === 'off' || /^(\d{1,2}):(\d{2})$/.test(resto)) {
            return false
        }

        const motivo = resto

        const fechado = await grupoEstaFechado(sock, from)
        if (fechado === true) {
            await sock.sendMessage(from, {
                text: 'ℹ️ *GRUPO JÁ FECHADO*\n──────────────────\n▸ Só administradores podem falar.'
            }, { quoted: msg })
            return true
        }

        try {
            await sock.groupSettingUpdate(from, 'announcement')
            invalidateGroupCache(from)
            const respostaText = motivo
                ? `🔒 *GRUPO FECHADO*\n──────────────────\n▸ 📌 *Motivo:* ${motivo}\n──────────────────\n▸ Só administradores podem enviar mensagens.`
                : '🔒 *GRUPO FECHADO*\n──────────────────\n▸ Só administradores podem enviar mensagens.'

            await sock.sendMessage(from, { text: respostaText }, { quoted: msg })
            return true
        } catch (err) {
            await sock.sendMessage(from, {
                text: '❌ *ERRO*\n──────────────────\n▸ Não foi possível fechar.\n▸ Confirme se o bot é admin.'
            }, { quoted: msg })
            return true
        }
    }

    if (text === prefix + 'id') {
        try {
            const metadata = await getGroupMetadataCached(sock, from)
            const info = `🆔 *DADOS DO GRUPO*\n──────────────────\n▸ ID: ${from}\n▸ 📛 Nome: ${metadata.subject}\n▸ 👥 Participantes: ${metadata.participants.length}`
            await sock.sendMessage(from, { text: info }, { quoted: msg })
        } catch (err) {
            await sock.sendMessage(from, { text: '❌ *ERRO*\n──────────────────\n▸ Falha ao obter os dados do grupo.' }, { quoted: msg })
        }
        return true
    }

    if (text.startsWith(prefix + 'promover')) {
        let target = msg.message?.extendedTextMessage?.contextInfo?.participant
        const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid
        if (!target && mentions && mentions.length > 0) {
            target = mentions[0]
        }

        if (!target) {
            await sock.sendMessage(from, { text: `❌ Responda à mensagem ou marque a pessoa.\nExemplo: ${prefix}promover @pessoa` }, { quoted: msg })
            return true
        }

        try {
            await sock.groupParticipantsUpdate(from, [target], 'promote')
            await sock.sendMessage(from, {
                text: `✅ *MEMBRO PROMOVIDO*\n──────────────────\n▸ @${target.split('@')[0]} é agora *administrador*!`,
                mentions: [target]
            }, { quoted: msg })
        } catch (err) {
            await sock.sendMessage(from, { text: '❌ *ERRO*\n──────────────────\n▸ Falha ao promover.\n▸ O bot precisa ser admin.' }, { quoted: msg })
        }
        return true
    }

    if (text.startsWith(prefix + 'rebaixar')) {
        let target = msg.message?.extendedTextMessage?.contextInfo?.participant
        const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid
        if (!target && mentions && mentions.length > 0) {
            target = mentions[0]
        }

        if (!target) {
            await sock.sendMessage(from, { text: `❌ Responda à mensagem ou marque a pessoa.\nExemplo: ${prefix}rebaixar @pessoa` }, { quoted: msg })
            return true
        }

        try {
            await sock.groupParticipantsUpdate(from, [target], 'demote')
            await sock.sendMessage(from, {
                text: `✅ *MEMBRO REBAIXADO*\n──────────────────\n▸ @${target.split('@')[0]} não é mais administrador.`,
                mentions: [target]
            }, { quoted: msg })
        } catch (err) {
            await sock.sendMessage(from, { text: '❌ *ERRO*\n──────────────────\n▸ Falha ao rebaixar.\n▸ O bot precisa ser admin.' }, { quoted: msg })
        }
        return true
    }

    if (text === prefix + 'delete' || text === prefix + 'del') {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo
        if (!quotedMsg?.stanzaId) {
            await sock.sendMessage(from, { text: '❌ Responda à mensagem que quer apagar.' }, { quoted: msg })
            return true
        }

        try {
            await sock.sendMessage(from, {
                delete: {
                    remoteJid: from,
                    fromMe: false,
                    id: quotedMsg.stanzaId,
                    participant: quotedMsg.participant
                }
            })
        } catch (err) {
            await sock.sendMessage(from, { text: '❌ *ERRO*\n──────────────────\n▸ Falha ao apagar a mensagem.' }, { quoted: msg })
        }
        return true
    }

    const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || ''
    if (body.toLowerCase().startsWith(prefix + 'hidetag')) {
        const texto = body.slice((prefix + 'hidetag').length).trim() || '📢 Aviso!'
        try {
            const metadata = await getGroupMetadataCached(sock, from)
            const participants = metadata.participants.map(p => p.id)
            await sock.sendMessage(from, {
                text: texto,
                mentions: participants
            })
        } catch (err) {
            await sock.sendMessage(from, { text: '❌ *ERRO*\n──────────────────\n▸ Falha ao enviar o hidetag.' }, { quoted: msg })
        }
        return true
    }

    if (text === prefix + 'marcar') {
        try {
            const metadata = await getGroupMetadataCached(sock, from)
            const participants = metadata.participants.map(p => p.id)
            const mentions = participants.map(p => `@${p.split('@')[0]}`).join(' ')
            await sock.sendMessage(from, {
                text: `📢 *ATENÇÃO, PESSOAL!*\n──────────────────\n▸ ${mentions}`,
                mentions: participants
            })
        } catch (err) {
            await sock.sendMessage(from, { text: '❌ *ERRO*\n──────────────────\n▸ Falha ao marcar todos.' }, { quoted: msg })
        }
        return true
    }

    return false
}

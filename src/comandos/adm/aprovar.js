const config = require('../../../data/config.json')
const { isAdmin: checkIsAdmin, isOwnerCheck } = require('../../utils/baileys.js')

module.exports = async (sock, msg, from, sender, text) => {
    if (!text.startsWith(config.prefix + 'aprovar')) return false

    const isGroup = from.endsWith('@g.us')
    const reply = (texto) => sock.sendMessage(from, { text: texto }, { quoted: msg })

    if (!isGroup) {
        await reply('❌ Comando exclusivo para grupos!')
        return true
    }

    const isOwner = isOwnerCheck(sender, msg)
    let isAdmin = false
    try {
        if (!isOwner) isAdmin = await checkIsAdmin(sock, from, sender)
    } catch { }

    if (!isAdmin && !isOwner) {

        await reply('❌ Recurso exclusivo para administradores!')
        return true
    }

    try {

        const pendingParticipants = await sock.groupRequestParticipantsList(from)

        if (!pendingParticipants || pendingParticipants.length === 0) {
            await reply('✅ *SEM PEDIDOS*\n──────────────────\n▸ Nenhum pedido pendente para aprovar')
            return true
        }

        await reply(`⏳ A analisar *${pendingParticipants.length}* pedido(s)...`)

        const participantsJid = pendingParticipants.map(participant => participant.jid)

        await sock.groupRequestParticipantsUpdate(
            from,
            participantsJid,
            'approve'
        )

        await reply(`✅ *PEDIDOS APROVADOS*\n──────────────────\n▸ *${pendingParticipants.length}* participante(s) aprovado(s)\n──────────────────`)

    } catch (err) {
        console.error('[ERRO-APROVAR]', err)
        await reply(`❌ *ERRO AO APROVAR*\n──────────────────\n▸ Não foi possível aprovar os participantes\n▸ Erro: ${err.message}`)
    }
    return true
}

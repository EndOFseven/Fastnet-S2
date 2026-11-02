const config = require('../../../data/config.json')
const { getGroupMetadataCached, isAdmin, isOwnerCheck } = require('../../utils/baileys')
const configManager = require('../../utils/configManager')

module.exports = async (sock, msg, from, sender, text) => {
    const lower = text.toLowerCase().trim()
    if (lower.startsWith(config.prefix + 'infogp') || lower.startsWith(config.prefix + 'infogrupo')) {
        if (!from.endsWith('@g.us')) {
            await sock.sendMessage(from, { text: '❌ Este comando é só para grupos.' }, { quoted: msg })
            return true
        }

        const isOwner = isOwnerCheck(sender, msg)
        let adminStatus = false
        try { adminStatus = await isAdmin(sock, from, sender) } catch {}
        if (!isOwner && !adminStatus) {
            return true
        }

        try {
            const metadata = await getGroupMetadataCached(sock, from)
            const groupConfig = configManager.loadGroupConfig()[from] || {}

            const admins = metadata.participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin')
            const totalMembros = metadata.participants.length
            const totalAdmins = admins.length

            const horaAbrir = groupConfig.horaAbrir ? `🔓 ${groupConfig.horaAbrir}` : 'Nenhum'
            const horaFechar = groupConfig.horaFechar ? `🔒 ${groupConfig.horaFechar}` : 'Nenhum'
            const botDesligado = groupConfig.botDesligado ? '🔴 Desligado' : '🟢 Ativo'

            let infoText = `📊 *DADOS DO GRUPO*\n`
            infoText += `──────────────────\n`
            infoText += `▸ 🏷️ *Nome:* ${metadata.subject || 'Sem nome'}\n`
            infoText += `▸ 🆔 *ID do Grupo:* \`${from}\`\n`
            infoText += `▸ 👥 *Total de Membros:* ${totalMembros}\n`
            infoText += `▸ 🛡️ *Administradores:* ${totalAdmins}\n`
            infoText += `▸ ⚙️ *Status do Bot:* ${botDesligado}\n`
            infoText += `▸ ⏰ *Abertura Agendada:* ${horaAbrir}\n`
            infoText += `▸ ⏰ *Fechamento Agendado:* ${horaFechar}\n`
            infoText += `──────────────────\n`
            infoText += `💡 *DICA*\n`
            infoText += `▸ Use o ID acima para copiar nanos, proteções e ajustes:\n`
            infoText += `▸ \`.copiarnano ID_DO_GRUPO\`\n`
            infoText += `▸ \`.copiarnanos ID_DO_GRUPO\`\n`
            infoText += `▸ \`.copiarprotecoes ID_DO_GRUPO\`\n`
            infoText += `▸ \`.copiarconfiguracoes ID_DO_GRUPO\`\n`
            infoText += `──────────────────`

            let ppUrl = null
            try {
                ppUrl = await sock.profilePictureUrl(from, 'image')
            } catch {}

            if (ppUrl) {
                await sock.sendMessage(from, {
                    image: { url: ppUrl },
                    caption: infoText
                }, { quoted: msg })
            } else {
                await sock.sendMessage(from, { text: infoText }, { quoted: msg })
            }

            return true
        } catch (err) {
            console.error('[INFOGP] Erro ao obter informações do grupo:', err.message)
            await sock.sendMessage(from, {
                text: `❌ *ERRO*\n──────────────────\n▸ Não foi possível carregar os dados do grupo.\n──────────────────`
            }, { quoted: msg })
            return true
        }
    }

    return false
}

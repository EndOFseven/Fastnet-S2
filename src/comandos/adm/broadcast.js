const config = require('../../../data/config.json')
const { isOwnerCheck, isSubdonoCheck } = require('../../utils/baileys')
const configManager = require('../../utils/configManager')

module.exports = async function (sock, msg, from, sender, text) {
    const rawTokens = text.trim().split(/\s+/)
    const rawCmd = (rawTokens[0] || '').toLowerCase()
    const prefix = config.prefix || '.'

    if (rawCmd !== prefix + 'bcast' && rawCmd !== prefix + 'broadcast') {
        return false
    }

    const isOwner = isOwnerCheck(sender, msg) || isSubdonoCheck(sender)
    if (!isOwner) {
        try { await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }) } catch {}
        await sock.sendMessage(from, { text: '❌ Só o dono ou os sub-donos podem enviar transmissões (broadcast).' }, { quoted: msg })
        return true
    }

    const mensagemTexto = text.substring(rawTokens[0].length).trim()

    if (!mensagemTexto || mensagemTexto === 'ajuda' || mensagemTexto === 'help') {
        await sock.sendMessage(from, {
            text: [
                '📢 *TRANSMISSÃO GLOBAL (BROADCAST)*',
                '────────────────────────',
                'Manda uma mensagem para todos os grupos autorizados do bot.',
                '',
                '📌 *Como usar:*',
                `👉 \`${prefix}bcast <sua mensagem aqui>\``,
                '',
                '💡 *Exemplo:*',
                `\`${prefix}bcast Caros clientes, estamos prontos para receber seus pedidos de megas!\``
            ].join('\n')
        }, { quoted: msg })
        return true
    }

    try { await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } }) } catch {}

    const allGroupConfigs = configManager.loadGroupConfig() || {}
    const targetGroups = Object.entries(allGroupConfigs)
        .filter(([jid, cfg]) => jid && jid.endsWith('@g.us') && cfg && cfg.authorized !== false)
        .map(([jid]) => jid)

    if (targetGroups.length === 0) {
        try { await sock.sendMessage(from, { react: { text: '⚠️', key: msg.key } }) } catch {}
        await sock.sendMessage(from, {
            text: '⚠️ Não há grupos autorizados para a transmissão.'
        }, { quoted: msg })
        return true
    }

    const corpoEnvio = mensagemTexto.startsWith('📢') || mensagemTexto.startsWith('⚠️') || mensagemTexto.startsWith('🔔')
        ? mensagemTexto
        : [
            '📢 *AVISO OFICIAL*',
            '────────────────────────',
            mensagemTexto,
            '────────────────────────'
        ].join('\n')

    let sucesso = 0
    let falhas = 0

    for (const gid of targetGroups) {
        try {
            await sock.sendMessage(gid, { text: corpoEnvio })
            sucesso++
        } catch (errSend) {
            falhas++
            console.error(`[BROADCAST] Falha ao enviar para ${gid}:`, errSend.message)
        }
        await new Promise(resolve => setTimeout(resolve, 350))
    }

    try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }) } catch {}

    const resumo = [
        '📢 *RESUMO DA TRANSMISSÃO (BROADCAST)*',
        '────────────────────────',
        `👥 *Grupos Alcançados:* ${targetGroups.length}`,
        `✅ *Entregues:* ${sucesso}`,
        `❌ *Falhas:* ${falhas}`,
        '────────────────────────',
        falhas === 0
            ? '⚡ _Mensagem entregue a todos os grupos!_'
            : `⚠️ _Falhou em ${falhas} grupo(s). Podem ter retirado o bot ou mudado as permissões._`
    ].join('\n')

    await sock.sendMessage(from, { text: resumo }, { quoted: msg })
    return true
}

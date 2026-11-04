const fs = require('fs')
const path = require('path')
const { isAdmin, isOwnerCheck } = require('../../utils/baileys.js')
const config = require('../../../data/config.json')

module.exports = async (sock, msg, from, sender, text) => {
    const rawCmd = text.trim().toLowerCase().split(/\s+/)[0]
    if (rawCmd !== config.prefix + 'menuadm' && rawCmd !== config.prefix + 'painel' && rawCmd !== config.prefix + 'adm') {
        return false
    }

    const isOwner = isOwnerCheck(sender, msg)
    const isGroup = from.endsWith('@g.us')

    if (!isOwner) {
        if (!isGroup) {
            await sock.sendMessage(from, { text: '❌ Este menu é só para administradores de grupo ou o dono do bot.' }, { quoted: msg })
            return true
        }
        let adminStatus = false
        try {
            adminStatus = await isAdmin(sock, from, sender)
        } catch { }

        if (!adminStatus) {
            await sock.sendMessage(from, { text: '❌ Este menu é restrito aos administradores do grupo.' }, { quoted: msg })
            return true
        }
    }

    const { getPrefixForChat } = require('../../utils/configManager')
    const prefix = getPrefixForChat(from)
    const userName = msg.pushName || 'Administrador'

    const header = [
        '🪐 *PAINEL ADMIN (MANUAL)* ',
        `Olá, ${userName}!`,
        '──────────────────'
    ].join('\n')

    const bloco1 = [
        '*📊 PAINEL & PLANOS (A-Z)*',
        '',
        `▸ ${prefix}configurar listar`,
        `▸ ${prefix}configurar saldo`,
        `▸ ${prefix}configurar tabela`,
        `▸ ${prefix}configurar ver saldo`,
        `▸ ${prefix}configurar ver tabela`,
        `▸ ${prefix}tabela`,
        `▸ ${prefix}tabelasaldo`,
        '──────────────────'
    ].join('\n')

    const bloco2 = [
        '*📦 CONTROLE DE VENDAS (A-Z)*',
        '',
        `▸ ${prefix}aumentarlimite`,
        `▸ ${prefix}compras`,
        `▸ ${prefix}limparcompras`,
        `▸ ${prefix}recuperarcompras`,
        `▸ ${prefix}rank [on/off/me]`,
        `▸ ${prefix}primeirobonus [on/off/status]`,
        `▸ ${prefix}confirmar [código]`,
        `▸ ${prefix}recusar [código]`,
        `▸ ${prefix}verificacao [modo]`,
        '──────────────────'
    ].join('\n')

    const bloco3 = [
        '*🛡️ DEFESA & SEGURANÇA (A-Z)*',
        '',
        `▸ ${prefix}antiaudio [on/off]`,
        `▸ ${prefix}antibot [on/off]`,
        `▸ ${prefix}antidoc [on/off]`,
        `▸ ${prefix}antiflood [on/off]`,
        `▸ ${prefix}antifoto [on/off]`,
        `▸ ${prefix}antigringo [on/off]`,
        `▸ ${prefix}antilink [on/off]`,
        `▸ ${prefix}antimidia [on/off]`,
        `▸ ${prefix}antipalavrao [on/off]`,
        `▸ ${prefix}antivideo [on/off]`,
        `▸ ${prefix}concorrentes [on/off]`,
        `▸ ${prefix}copiarprotecoes`,
        '──────────────────'
    ].join('\n')

    const bloco4 = [
        '*👥 ADMINISTRAÇÃO DO GRUPO (A-Z)*',
        '',
        `▸ ${prefix}aviso [texto]`,
        `▸ ${prefix}ban @membro`,
        `▸ ${prefix}bemvindo [on/off]`,
        `▸ ${prefix}grupo [abrir/fechar]`,
        `▸ ${prefix}infogp`,
        `▸ ${prefix}limpar`,
        `▸ ${prefix}linkgp`,
        `▸ ${prefix}mute [minutos]`,
        `▸ ${prefix}prefixo [novo]`,
        `▸ ${prefix}todos [texto]`,
        `▸ ${prefix}unmute`,
        `▸ ${prefix}x9 [on/off]`,
        '──────────────────'
    ].join('\n')

    const bloco5 = [
        '*🔑 LICENÇAS & AJUSTES (A-Z)*',
        '',
        `▸ ${prefix}ativarlicenca [chave]`,
        `▸ ${prefix}bot [on/off]`,
        `▸ ${prefix}ping`,
        `▸ ${prefix}renovar`,
        '──────────────────'
    ].join('\n')

    const menuAdmText = [header, '', bloco1, '', bloco2, '', bloco3, '', bloco4, '', bloco5].join('\n')

    const logoPath = path.join(__dirname, '../../../assets', 'menuadm.jpg')

    if (fs.existsSync(logoPath)) {
        await sock.sendMessage(from, {
            image: fs.readFileSync(logoPath),
            caption: menuAdmText
        }, { quoted: msg })
    } else {
        await sock.sendMessage(from, { text: menuAdmText }, { quoted: msg })
    }
    return true
}

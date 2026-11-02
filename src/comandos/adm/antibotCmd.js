const config = require('../../../data/config.json')
const configManager = require('../../utils/configManager')
const { isAdmin: checkIsAdmin, isOwnerCheck } = require('../../utils/baileys.js')

module.exports = async (sock, msg, from, sender, text) => {
    const { getPrefixForChat } = require('../../utils/configManager')
    const prefix = getPrefixForChat ? getPrefixForChat(from) : config.prefix
    const lower = text.trim().toLowerCase()

    if (!lower.startsWith(prefix + 'antibot')) return false

    const isGroup = from.endsWith('@g.us')
    const reply = (texto) => sock.sendMessage(from, { text: texto }, { quoted: msg })

    if (!isGroup) {
        await reply('❌ Comando disponível apenas em grupos!')
        return true
    }

    const isOwner = isOwnerCheck(sender, msg)
    let isAdmin = false
    try {
        if (!isOwner) isAdmin = await checkIsAdmin(sock, from, sender)
    } catch { }

    if (!isAdmin && !isOwner) {
        await reply('❌ Só administradores podem ajustar o Anti-Bot!')
        return true
    }

    const groupConfig = configManager.loadGroupConfig()
    if (!groupConfig[from]) groupConfig[from] = {}

    const args = text.trim().split(/\s+/)
    const subCmd = args[1]?.toLowerCase()
    const subParam = args[2]?.toLowerCase()

    const userName = msg.pushName || 'Administrador'

    if (!subCmd || subCmd === 'ajuda' || subCmd === 'help') {
        const isAtivo = groupConfig[from].antibot === true || groupConfig[from].antiBot === true
        const modoAtual = (groupConfig[from].antibotModo || 'ban').toUpperCase()
        const statusTexto = isAtivo ? '🟢 ATIVADO' : '🔴 DESATIVADO'

        const header = [
            '🛡️ *PROTEÇÃO ANTI-BOT* ',
            `Olá, ${userName}!`,
            `Situação: *${statusTexto}* | Modo: *${modoAtual}*`,
            '──────────────────'
        ].join('\n')

        const bloco = [
            '*⚙️ O QUE VOCÊ PODE FAZER*',
            '',
            `▸ ${prefix}antibot on ➔ Ligar a proteção`,
            `▸ ${prefix}antibot off ➔ Desligar a proteção`,
            `▸ ${prefix}antibot modo ban ➔ Remover só o bot invasor`,
            `▸ ${prefix}antibot modo duplo ➔ Remover o bot e quem o adicionou`,
            `▸ ${prefix}antibot status ➔ Consultar os detalhes`,
            '──────────────────'
        ].join('\n')

        const footer = [
            '🔒 *PROTEÇÃO TOTAL*',
            'Administradores e robôs oficiais têm passe livre.',
            '──────────────────'
        ].join('\n')

        await reply([header, '', bloco, '', footer].join('\n'))
        return true
    }

    if (subCmd === 'status') {
        const isAtivo = groupConfig[from].antibot === true || groupConfig[from].antiBot === true
        const modoAtual = (groupConfig[from].antibotModo || 'ban').toLowerCase()
        const modoDesc = modoAtual === 'duplo' || modoAtual === 'total'
            ? 'Remover o bot invasor e também quem o adicionou'
            : 'Remover somente o bot invasor'

        const cardStatus = [
            '🛡️ *SITUAÇÃO DO ANTI-BOT* ',
            '',
            `🛡️  *Proteção:* ${isAtivo ? '🟢 ATIVADA' : '🔴 DESATIVADA'}`,
            `⚔️  *Modo:* ${modoAtual.toUpperCase()} (${modoDesc})`,
            '🔍  *Monitora:* Botões API, excesso de pedidos de aluguel/licença',
            'e mensagens de erro típicas de robôs.',
            '🔒  *Proteção especial:* Administradores e Dono estão seguros.',
            '──────────────────'
        ].join('\n')

        await reply(cardStatus)
        return true
    }

    if (subCmd === 'on' || subCmd === 'ativar') {
        groupConfig[from].antibot = true
        if (!groupConfig[from].antibotModo) {
            groupConfig[from].antibotModo = 'ban'
        }
        configManager.saveGroupConfig(groupConfig)

        const cardAtivado = [
            '🛡️ *ANTI-BOT LIGADO* ',
            '',
            '✅  *A proteção contra robôs invasores está funcionando!*',
            `⚔️  *Modo inicial:* REMOVER O BOT INVASOR`,
            '🗑️  Mensagens enviadas por outros bots são apagadas na hora.',
            `💡  Quer remover também quem convidou o bot? Use *${prefix}antibot modo duplo*`,
            '──────────────────'
        ].join('\n')

        await reply(cardAtivado)
        try { await sock.sendMessage(from, { react: { text: '🛡️', key: msg.key } }) } catch {}
        return true
    }

    if (subCmd === 'off' || subCmd === 'desativar') {
        groupConfig[from].antibot = false
        configManager.saveGroupConfig(groupConfig)

        const cardDesativado = [
            '🛡️ *ANTI-BOT DESLIGADO* ',
            '',
            '❌  *O Anti-Bot foi desligado neste grupo.*',
            `💡  Quer ligar de novo? Use *${prefix}antibot on*`,
            '──────────────────'
        ].join('\n')

        await reply(cardDesativado)
        try { await sock.sendMessage(from, { react: { text: '⚪', key: msg.key } }) } catch {}
        return true
    }

    if (subCmd === 'modo') {
        if (subParam === 'ban' || subParam === 'simples') {
            groupConfig[from].antibotModo = 'ban'
            configManager.saveGroupConfig(groupConfig)
            await reply([
                '🛡️ *MODO ALTERADO* ',
                '',
                '✅  *Anti-Bot agora está em: REMOVER SÓ O BOT*',
                '👤  Quem adicionou o invasor receberá apenas um alerta.',
                '──────────────────'
            ].join('\n'))
            return true
        }

        if (subParam === 'duplo' || subParam === 'total' || subParam === 'ambos') {
            groupConfig[from].antibotModo = 'duplo'
            configManager.saveGroupConfig(groupConfig)
            await reply([
                '🛡️ *MODO ALTERADO* ',
                '',
                '⚠️  *Anti-Bot agora está em: REMOÇÃO DUPLA*',
                '🚫  Tanto o bot invasor quanto quem o adicionou serão removidos!',
                '──────────────────'
            ].join('\n'))
            return true
        }

        await reply(`⚠️ Forma correta: *${prefix}antibot modo ban* ou *${prefix}antibot modo duplo*`)
        return true
    }

    await reply(`⚠️ Opção desconhecida. Digite *${prefix}antibot* para abrir o painel.`)
    return true
}

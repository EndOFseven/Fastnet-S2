const fs = require('fs')
const path = require('path')
const config = require('../../../data/config.json')
const { isAdmin, isOwnerCheck } = require('../../utils/baileys')
const { getPrefixForChat, setGroupPrefix } = require('../../utils/configManager')

const prefixoHandler = async function (sock, msg, from, sender, text) {
        const rawTokens = (text || '').trim().split(/\s+/)
        const cmd = rawTokens[0].toLowerCase()
        const basePrefix = config.prefix || '.'

        const isMatch = (
            cmd === basePrefix + 'prefixo' ||
            cmd === basePrefix + 'prefix' ||
            cmd === basePrefix + 'setprefix' ||
            cmd === basePrefix + 'prefixogrupo'
        )

        if (!isMatch) return false

        const isGroup = from && from.endsWith('@g.us')
        if (!isGroup) {
            await sock.sendMessage(from, { text: '❌ Comando válido apenas dentro de grupos.' }, { quoted: msg })
            return true
        }

        const isOwner = isOwnerCheck(sender, msg)
        let isAdm = false
        try {
            isAdm = await isAdmin(sock, from, sender)
        } catch {}

        if (!isOwner && !isAdm) {
            await sock.sendMessage(from, { text: '❌ Só admins do grupo ou o dono do bot mudam o prefixo daqui.' }, { quoted: msg })
            return true
        }

        const currentPrefix = getPrefixForChat(from)
        const args = rawTokens.slice(1)
        const newPrefixRaw = args[0] ? args[0].trim() : ''

        if (!newPrefixRaw) {
            const helpMsg = [
                '🪐 *PREFIXO DO GRUPO* ',
                '',
                `▸ Prefixo atual: *${currentPrefix}*`,
                `▸ ${currentPrefix}prefixo <prefixo>`,
                `▸ ${currentPrefix}prefixo reset`,
                `▸ ${currentPrefix}menuprefix`,
                '──────────────────'
            ].join('\n')

            const logoPath = path.join(__dirname, '../../../assets', 'menuadm.jpg')

            if (fs.existsSync(logoPath)) {
                await sock.sendMessage(from, {
                    image: fs.readFileSync(logoPath),
                    caption: helpMsg
                }, { quoted: msg })
            } else {
                await sock.sendMessage(from, { text: helpMsg }, { quoted: msg })
            }
            return true
        }

        const lowerArg = newPrefixRaw.toLowerCase()
        if (lowerArg === 'reset' || lowerArg === 'padrao' || lowerArg === 'padrão') {
            setGroupPrefix(from, null)
            await sock.sendMessage(from, {
                text: `✅ *Prefixo do grupo restaurado!*\n\nO grupo voltou a usar o prefixo padrão do bot: *${basePrefix}*\nExemplo: *${basePrefix}menu*`
            }, { quoted: msg })
            return true
        }

        if (newPrefixRaw.length > 2 || /^[a-zA-Z0-9\s]+$/.test(newPrefixRaw)) {
            await sock.sendMessage(from, {
                text: '❌ *Prefixo inválido!*\n\nEscolha 1 ou 2 caracteres especiais (símbolos).\nExemplos válidos: `.`, `!`, `#`, `?`, `$`, `/`, `-`'
            }, { quoted: msg })
            return true
        }

        const ok = setGroupPrefix(from, newPrefixRaw)
        if (!ok) {
            await sock.sendMessage(from, { text: '❌ Não foi possível gravar o novo prefixo. Tente outra vez.' }, { quoted: msg })
            return true
        }

        const successMsg = [
            '✅ *Novo prefixo aplicado neste grupo!*',
            '────────────────────────',
            `📌 Prefixo atual: *${newPrefixRaw}*`,
            `💡 Daqui em diante, os comandos deste grupo usam *${newPrefixRaw}* (ex: *${newPrefixRaw}menu*, *${newPrefixRaw}tabela*).`,
            '',
            `_Para voltar ao padrão a qualquer momento: ${newPrefixRaw}prefixo reset_`
        ].join('\n')

        await sock.sendMessage(from, { text: successMsg }, { quoted: msg })
        return true
}

prefixoHandler.nome = 'prefixo'
prefixoHandler.name = 'prefixo'
prefixoHandler.aliases = ['prefix', 'setprefix', 'prefixogrupo']
prefixoHandler.categoria = 'adm'
prefixoHandler.descricao = 'Altera o prefixo de comandos exclusivamente deste grupo'
prefixoHandler.uso = `${config.prefix}prefixo <novo_prefixo>`

module.exports = prefixoHandler

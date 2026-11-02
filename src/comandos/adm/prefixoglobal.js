const fs = require('fs')
const path = require('path')
const config = require('../../../data/config.json')
const { isOwnerCheck, isLeaderCheck } = require('../../utils/baileys')
const { setGlobalPrefix } = require('../../utils/configManager')

const prefixoGlobalHandler = async function (sock, msg, from, sender, text) {
        const rawTokens = (text || '').trim().split(/\s+/)
        const cmd = rawTokens[0].toLowerCase()
        const basePrefix = config.prefix || '.'

        const isMatch = (
            cmd === basePrefix + 'prefixoglobal' ||
            cmd === basePrefix + 'setprefixglobal' ||
            cmd === basePrefix + 'botprefix' ||
            cmd === basePrefix + 'prefixobot'
        )

        if (!isMatch) return false

        const isLeader = isLeaderCheck(sender, msg)
        const isOwner = isOwnerCheck(sender, msg)

        if (!isLeader && !isOwner) {
            await sock.sendMessage(from, { text: '❌ Somente o dono líder do bot muda o prefixo global.' }, { quoted: msg })
            return true
        }

        const args = rawTokens.slice(1)
        const newPrefixRaw = args[0] ? args[0].trim() : ''

        if (!newPrefixRaw) {
            const helpMsg = [
                '🪐 *PREFIXO GLOBAL* ',
                '',
                `▸ Prefixo global atual: *${basePrefix}*`,
                `▸ ${basePrefix}prefixoglobal <prefixo>`,
                `▸ ${basePrefix}menuprefix`,
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

        if (newPrefixRaw.length > 2 || /^[a-zA-Z0-9\s]+$/.test(newPrefixRaw)) {
            await sock.sendMessage(from, {
                text: '❌ *Prefixo inválido!*\n\nEscolha 1 ou 2 caracteres especiais (símbolos).\nExemplos válidos: `.`, `!`, `#`, `?`, `$`, `/`, `-`'
            }, { quoted: msg })
            return true
        }

        const ok = setGlobalPrefix(newPrefixRaw)
        if (!ok) {
            await sock.sendMessage(from, { text: '❌ Não foi possível gravar o prefixo global no config.json. Confira as permissões.' }, { quoted: msg })
            return true
        }

        const successMsg = [
            '🌐 *Prefixo Global Atualizado!*',
            '────────────────────────',
            `📌 Novo prefixo padrão: *${newPrefixRaw}*`,
            `💡 Grupos e conversas no padrão passam a responder a *${newPrefixRaw}*.`,
            '',
            '🔒 *Grupos com prefixo próprio:* seguem funcionando com o prefixo personalizado, sem alteração.'
        ].join('\n')

        await sock.sendMessage(from, { text: successMsg }, { quoted: msg })
        return true
}

prefixoGlobalHandler.nome = 'prefixoglobal'
prefixoGlobalHandler.name = 'prefixoglobal'
prefixoGlobalHandler.aliases = ['setprefixglobal', 'botprefix', 'prefixobot']
prefixoGlobalHandler.categoria = 'dono'
prefixoGlobalHandler.descricao = 'Altera o prefixo padrão global do bot em todos os grupos que usam o padrão'
prefixoGlobalHandler.uso = `${config.prefix}prefixoglobal <novo_prefixo>`

module.exports = prefixoGlobalHandler

const path = require('path')
const config = require(path.join(__dirname, '../../../data/config.json'))
const { isLeaderCheck } = require('../../utils/baileys')
const configManager = require('../../utils/configManager')
const { botStatusStore } = require('../../utils/firebaseDataLayer')

module.exports = async (sock, msg, from, sender, text) => {
    const prefix = config.prefix || '.'
    const cleanText = (text || '').trim()
    const lower = cleanText.toLowerCase()

    const isOnAll = lower === (prefix + 'onall') || lower.startsWith(prefix + 'onall ') || lower.startsWith(prefix + 'onall\t')
    const isOn = lower === (prefix + 'on') || lower.startsWith(prefix + 'on ') || lower.startsWith(prefix + 'on\t')

    if (isOnAll || isOn) {

        if (!isLeaderCheck(sender, msg)) {
            await sock.sendMessage(from, {
                text: [
                    '🪐 *ACESSO NEGADO* ',
                    '❌ Sem permissão',
                    '──────────────────',
                    '',
                    'Somente o dono principal do bot pode ativar o atendimento.'
                ].join('\n')
            }, { quoted: msg })
            return true
        }

        const isGroup = from.endsWith('@g.us')
        const args = cleanText.split(/\s+/).slice(1)
        const subComando = (args[0] || '').toLowerCase()

        if (isOnAll || subComando === 'todos' || subComando === 'all' || subComando === 'global') {
            try {
                botStatusStore.save({ ativo: true }, true)
                await sock.sendMessage(from, {
                    text: [
                        '🪐 *STATUS DO SISTEMA* ',
                        '🤖 SEVEN BOT',
                        '──────────────────',
                        '',
                        '*🟢 BOT ATIVO EM TODOS OS GRUPOS*',
                        '▸  O atendimento foi retomado em toda a rede.',
                        '──────────────────'
                    ].join('\n')
                }, { quoted: msg })
            } catch (err) {
                console.error('[ONALL] Erro ao reativar bot:', err.message)
            }
            return true
        }

        let targetJid = from

        if (subComando && /^\d+$/.test(subComando)) {
            const index = parseInt(subComando)
            const aluguel = require('./aluguel')
            const obterMapaGrupos = aluguel.obterMapaGrupos || (() => {
                const groups = configManager.loadGroupConfig()
                return Object.entries(groups)
                    .filter(([id, cfg]) => cfg.authorized)
                    .map(([id]) => id)
                    .sort((a, b) => a[0].localeCompare(b[0]))
            })
            const jids = obterMapaGrupos()
            if (index < 1 || index > jids.length) {
                await sock.sendMessage(from, { text: `❌ Índice fora do intervalo. Escolha um número de 1 a ${jids.length}.` }, { quoted: msg })
                return true
            }
            targetJid = jids[index - 1]
        } else {
            if (!isGroup) {
                await sock.sendMessage(from, {
                    text: [
                        '🪐 *AJUDA DE COMANDO* ',
                        '⚙️ Ativar o Bot',
                        '──────────────────',
                        '',
                        `• \`${prefix}onall\` • Ativar o bot em todos os grupos`,
                        `• \`${prefix}on <número>\` • Ativar grupo pelo índice`,
                        `• \`${prefix}on\` • Ativar o grupo atual`
                    ].join('\n')
                }, { quoted: msg })
                return true
            }
        }

        const groups = configManager.loadGroupConfig()
        const cfg = groups[targetJid]

        if (!cfg || !cfg.botDesligado) {
            await sock.sendMessage(from, {
                text: [
                    '🪐 *AVISO* ',
                    '🤖 SEVEN BOT',
                    '──────────────────',
                    '',
                    'Este grupo já está em funcionamento.',
                    `_Para ativar o bot em todos os grupos:_ \`${prefix}onall\``
                ].join('\n')
            }, { quoted: msg })
            return true
        }

        delete groups[targetJid].botDesligado
        delete groups[targetJid].offPor
        delete groups[targetJid].offExpiraEm

        configManager.saveGroupConfig(true)

        try {
            await sock.sendMessage(targetJid, {
                text: [
                    '🪐 *STATUS DO GRUPO* ',
                    '🤖 SEVEN BOT',
                    '──────────────────',
                    '',
                    '*🟢 BOT REATIVADO*',
                    '▸  O atendimento voltou ao normal neste grupo.',
                    '──────────────────'
                ].join('\n')
            })
        } catch (e) {
            console.error('Erro ao enviar aviso de on no grupo:', e.message)
        }

        if (targetJid !== from) {
            await sock.sendMessage(from, {
                text: `✅ Grupo ${targetJid.split('@')[0]} voltou a funcionar.`
            }, { quoted: msg })
        }

        return true
    }
    return false
}

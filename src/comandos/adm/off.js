const path = require('path')
const config = require(path.join(__dirname, '../../../data/config.json'))
const { isLeaderCheck } = require('../../utils/baileys')
const configManager = require('../../utils/configManager')
const { botStatusStore } = require('../../utils/firebaseDataLayer')

function getDataMocambique() {
    const now = new Date()
    const offset = 2 * 60
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000)
    return new Date(utc + (offset * 60000))
}

function parseTempo(str) {
    const match = str.match(/^(\d+)\s*(s|seg|segundo|segundos|min|minuto|minutos|h|hora|horas|d|dia|dias|mes|meses|a|ano|anos)?$/i)
    if (!match) return null

    const valor = parseInt(match[1])
    const unidade = (match[2] || 'd').toLowerCase()

    const MS = 1000, MIN = 60 * MS, HR = 60 * MIN, DIA = 24 * HR
    switch (unidade) {
        case 's': case 'seg': case 'segundo': case 'segundos': return valor * MS
        case 'min': case 'minuto': case 'minutos': return valor * MIN
        case 'h': case 'hora': case 'horas': return valor * HR
        case 'd': case 'dia': case 'dias': return valor * DIA
        case 'mes': case 'meses': return valor * 30 * DIA
        case 'a': case 'ano': case 'anos': return valor * 365 * DIA
        default: return valor * DIA
    }
}

module.exports = async (sock, msg, from, sender, text) => {
    const prefix = config.prefix || '.'
    const cleanText = (text || '').trim()
    const lower = cleanText.toLowerCase()

    const isOffAll = lower === (prefix + 'offall') || lower.startsWith(prefix + 'offall ') || lower.startsWith(prefix + 'offall\t')
    const isOff = lower === (prefix + 'off') || lower.startsWith(prefix + 'off ') || lower.startsWith(prefix + 'off\t')

    if (isOffAll || isOff) {

        if (!isLeaderCheck(sender, msg)) {
            await sock.sendMessage(from, {
                text: [
                    '🪐 *ACESSO NEGADO* ',
                    '❌ Sem permissão',
                    '──────────────────',
                    '',
                    'Somente o dono principal do bot pode desativar o atendimento.'
                ].join('\n')
            }, { quoted: msg })
            return true
        }

        const isGroup = from.endsWith('@g.us')
        const args = cleanText.split(/\s+/).slice(1)
        const subComando = (args[0] || '').toLowerCase()

        if (isOffAll || subComando === 'todos' || subComando === 'all' || subComando === 'global') {
            try {
                botStatusStore.save({ ativo: false }, true)
                await sock.sendMessage(from, {
                    text: [
                        '🪐 *STATUS DO SISTEMA* ',
                        '🤖 SEVEN BOT',
                        '──────────────────',
                        '',
                        '*🔴 BOT PAUSADO EM TODOS OS GRUPOS*',
                        '▸  O atendimento está suspenso em toda a rede.',
                        `▸  Para reativar: \`${prefix}onall\``,
                        '──────────────────'
                    ].join('\n')
                }, { quoted: msg })
            } catch (err) {
                console.error('[OFFALL] Erro ao desativar bot:', err.message)
            }
            return true
        }

        let targetJid = from
        let durationStr = args.join(' ')

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
            durationStr = args.slice(1).join(' ')
        } else {
            if (!isGroup) {
                await sock.sendMessage(from, {
                    text: [
                        '🪐 *AJUDA DE COMANDO* ',
                        '⚙️ Pausar o Bot',
                        '──────────────────',
                        '',
                        `• \`${prefix}offall\` • Pausar o bot em todos os grupos`,
                        `• \`${prefix}off <número>\` • Pausar grupo pelo índice`,
                        `• \`${prefix}off [tempo]\` • Pausar o grupo atual`
                    ].join('\n')
                }, { quoted: msg })
                return true
            }
        }

        const groups = configManager.loadGroupConfig()
        if (!groups[targetJid]) groups[targetJid] = {}

        let tempoMs = null
        let offExpiraEm = null

        if (durationStr) {
            tempoMs = parseTempo(durationStr)
            if (!tempoMs) {
                await sock.sendMessage(from, { text: '❌ Tempo inválido (ex: 1d, 2h, 30min).' }, { quoted: msg })
                return true
            }
            offExpiraEm = getDataMocambique().getTime() + tempoMs
        }

        groups[targetJid].botDesligado = true
        groups[targetJid].offPor = 'dono'
        if (offExpiraEm) {
            groups[targetJid].offExpiraEm = offExpiraEm
        } else {
            delete groups[targetJid].offExpiraEm
        }

        configManager.saveGroupConfig(true)

        const { getSuporteNumber } = require('../../utils/configManager')
        const suporteNum = getSuporteNumber()
        const linkDono = `wa.me/${suporteNum}`
        const tempoTxt = durationStr ? ` por ${durationStr}` : ' por tempo indeterminado'

        try {
            await sock.sendMessage(targetJid, {
                text: [
                    '🪐 *STATUS DO GRUPO* ',
                    '🤖 SEVEN BOT',
                    '──────────────────',
                    '',
                    '*🔴 BOT DESATIVADO*',
                    `▸  O atendimento foi pausado${tempoTxt} neste grupo.`,
                    `▸  Fale com o suporte: ${linkDono}`,
                    '──────────────────'
                ].join('\n')
            })
        } catch (e) {
            console.error('Erro ao enviar aviso de off no grupo:', e.message)
        }

        if (targetJid !== from) {
            await sock.sendMessage(from, { text: `✅ Grupo ${targetJid.split('@')[0]} pausado com sucesso.` }, { quoted: msg })
        }

        return true
    }
    return false
}

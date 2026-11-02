const { isLeaderCheck, addSubdono, removeSubdono, loadSubdonos } = require('../../utils/baileys.js')
const config = require('../../../data/config.json')

module.exports = async (sock, msg, from, sender, text) => {
    const prefix = config.prefix || '.'
    const rawTokens = (text || '').trim().split(/\s+/)
    const firstToken = (rawTokens[0] || '').toLowerCase()

    if (firstToken.startsWith(prefix + 'subdono') ||
        firstToken.startsWith(prefix + 'addsubdono') ||
        firstToken.startsWith(prefix + 'delsubdono')) {

        if (!isLeaderCheck(sender, msg)) {
            await sock.sendMessage(from, {
                text: [
                    '🪐 *ACESSO NEGADO* ',
                    '❌ Sem permissão',
                    '──────────────────',
                    '',
                    'Somente o dono principal do bot pode gerenciar subdonos.'
                ].join('\n')
            }, { quoted: msg })
            return true
        }

        const cmd = firstToken.replace(prefix, '')

        let action = ''
        let target = ''

        if (cmd === 'addsubdono') {
            action = 'add'
            target = rawTokens.slice(1).join(' ')
        } else if (cmd === 'delsubdono') {
            action = 'del'
            target = rawTokens.slice(1).join(' ')
        } else {
            action = (rawTokens[1] || '').toLowerCase()
            target = rawTokens.slice(2).join(' ')
        }

        if (action === 'listar' || (!action && cmd === 'subdono')) {
            const subdonos = loadSubdonos()
            if (!subdonos || subdonos.length === 0) {
                await sock.sendMessage(from, {
                    text: [
                        '🪐 *SUBDONOS DO BOT* ',
                        '🤖 SEVEN BOT',
                        '──────────────────',
                        '',
                        '*👥 SUBDONOS AUTORIZADOS*',
                        '▸  Nenhum subdono registrado.',
                        '──────────────────'
                    ].join('\n')
                }, { quoted: msg })
            } else {
                let lines = [
                    '🪐 *SUBDONOS DO BOT* ',
                    '🤖 SEVEN BOT',
                    '──────────────────',
                    '',
                    '*👥 SUBDONOS AUTORIZADOS*'
                ]
                subdonos.forEach((num, i) => {
                    lines.push(`▸  ${i + 1}. @${num}`)
                })
                lines.push('──────────────────')
                await sock.sendMessage(from, {
                    text: lines.join('\n'),
                    mentions: subdonos.map(n => n + '@s.whatsapp.net')
                }, { quoted: msg })
            }
            return true
        }

        let targetNum = null

        const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant
        if (quoted) {
            targetNum = quoted.split('@')[0].split(':')[0]
        }

        const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid
        if (!targetNum && mentions && mentions.length > 0) {
            targetNum = mentions[0].split('@')[0].split(':')[0]
        }

        if (!targetNum && target) {
            targetNum = target.replace(/\D/g, '')
        }

        if (!targetNum || targetNum.length < 7) {
            await sock.sendMessage(from, {
                text: [
                    '🪐 *GERENCIAR SUBDONOS* ',
                    '⚙️ Painel do Líder',
                    '──────────────────',
                    '',
                    'Marque o usuário, responda a uma mensagem dele ou informe o número:',
                    '',
                    `👉 *Adicionar:* \`${prefix}subdono add @user\` ou \`${prefix}addsubdono 25884xxxxxxx\``,
                    `👉 *Remover:* \`${prefix}subdono del @user\` ou \`${prefix}delsubdono 25884xxxxxxx\``,
                    `👉 *Listar:* \`${prefix}subdono listar\``
                ].join('\n')
            }, { quoted: msg })
            return true
        }

        if (action === 'add') {
            const adicionado = addSubdono(targetNum)
            if (adicionado) {
                await sock.sendMessage(from, {
                    text: [
                        '🪐 *SUBDONO ADICIONADO* ',
                        '🤖 SEVEN BOT',
                        '──────────────────',
                        '',
                        '*✅ ACESSO CONCEDIDO*',
                        `▸  Usuário: @${targetNum}`,
                        '▸  Registro salvo no Firebase e no Servidor.',
                        '──────────────────'
                    ].join('\n'),
                    mentions: [targetNum + '@s.whatsapp.net']
                }, { quoted: msg })
            } else {
                await sock.sendMessage(from, {
                    text: [
                        '🪐 *AVISO* ',
                        '🤖 SEVEN BOT',
                        '──────────────────',
                        '',
                        `ℹ️ @${targetNum} já está na lista de subdonos.`
                    ].join('\n'),
                    mentions: [targetNum + '@s.whatsapp.net']
                }, { quoted: msg })
            }
        } else if (action === 'del' || action === 'remove') {
            const removido = removeSubdono(targetNum)
            if (removido) {
                await sock.sendMessage(from, {
                    text: [
                        '🪐 *SUBDONO REMOVIDO* ',
                        '🤖 SEVEN BOT',
                        '──────────────────',
                        '',
                        '*🗑️ ACESSO REVOGADO*',
                        `▸  Usuário: @${targetNum}`,
                        '▸  Retirado do Firebase e do Servidor.',
                        '──────────────────'
                    ].join('\n'),
                    mentions: [targetNum + '@s.whatsapp.net']
                }, { quoted: msg })
            } else {
                await sock.sendMessage(from, {
                    text: [
                        '🪐 *AVISO* ',
                        '🤖 SEVEN BOT',
                        '──────────────────',
                        '',
                        `❌ @${targetNum} não consta na lista de subdonos.`
                    ].join('\n'),
                    mentions: [targetNum + '@s.whatsapp.net']
                }, { quoted: msg })
            }
        } else {
            await sock.sendMessage(from, {
                text: '❌ Opção inválida. Use `add`, `del` ou `listar`.'
            }, { quoted: msg })
        }

        return true
    }
    return false
}

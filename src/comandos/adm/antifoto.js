const config = require('../../../data/config.json')
const configManager = require('../../utils/configManager')
const { isAdmin: checkIsAdmin, isOwnerCheck } = require('../../utils/baileys.js')
const { avisosStore } = require('../../utils/firebaseDataLayer')

function loadAvisos() {
    return avisosStore.loadSync() || {}
}

function saveAvisos(data) {
    avisosStore.save(data)
}

function obterBotNumbers(sock) {
    const nums = new Set()
    const myId = sock?.user?.id
    if (myId) {
        nums.add(myId.split(':')[0].split('@')[0].replace(/\D/g, ''))
    }
    if (config.ownerNumber) {
        nums.add(String(config.ownerNumber).replace(/\D/g, ''))
    }
    if (config.numeroDono) {
        nums.add(String(config.numeroDono).replace(/\D/g, ''))
    }
    return nums
}

/**
 * Middleware para processamento do Anti-Foto antes do OCR.
 * Executa exclusão da foto, advertência (strikes 1 e 2) e ban no 3º strike.
 */
async function processarAntiFoto(sock, msg, from, sender) {
    try {
        if (!from || !from.endsWith('@g.us')) return false
        if (msg.key?.fromMe) return false

        const groupConfig = configManager.loadGroupConfig()
        const isAtivo = groupConfig[from]?.antifoto === true || groupConfig[from]?.antiFoto === true
        if (!isAtivo) return false

        const messageContent = msg.message?.ephemeralMessage?.message ||
                               msg.message?.viewOnceMessage?.message ||
                               msg.message?.viewOnceMessageV2?.message ||
                               msg.message

        if (!messageContent?.imageMessage) return false

        // Blindagem contra imunidades: bot e donos
        const senderNum = String(sender || '').split('@')[0].split(':')[0].replace(/\D/g, '')
        const botNumbers = obterBotNumbers(sock)
        if (botNumbers.has(senderNum)) return false

        // Imunidade para administradores reais e dono
        const isOwner = isOwnerCheck(sender, msg)
        if (isOwner) return false

        let isAdminUser = false
        try {
            isAdminUser = await checkIsAdmin(sock, from, sender)
        } catch { }
        if (isAdminUser) return false

        console.log(`[ANTI-FOTO] 📸 Imagem detectada de @${senderNum} em grupo com anti-foto ativo (${from}). Apagando...`)

        // 1. Apagar mensagem imediatamente
        let apagou = false
        try {
            await sock.sendMessage(from, { delete: msg.key })
            apagou = true
        } catch (errDel) {
            console.error('[ANTI-FOTO] Erro ao deletar imagem:', errDel.message)
            try {
                const deleteKey = {
                    remoteJid: from,
                    fromMe: false,
                    id: msg.key.id,
                    participant: msg.key.participant || sender
                }
                await sock.sendMessage(from, { delete: deleteKey })
                apagou = true
            } catch { }
        }

        // 2. Sistema de Avisos / Strikes
        const avisos = loadAvisos()
        if (!avisos.fotos) avisos.fotos = {}
        if (!avisos.fotos[from]) avisos.fotos[from] = {}
        if (!avisos.fotos[from][sender]) avisos.fotos[from][sender] = 0

        avisos.fotos[from][sender]++
        const strike = avisos.fotos[from][sender]
        saveAvisos(avisos)

        const mention = [sender]

        // 3. Punição baseada nos strikes
        if (strike >= 3) {
            try {
                await sock.groupParticipantsUpdate(from, [sender], 'remove')
                const cardBan = [
                    '🚫 *REMOÇÃO - ANTI-FOTO* ',
                    '',
                    `👤 *Infrator:* @${senderNum}`,
                    '🚫 *Motivo:* envio de fotos não permitido (3 avisos)',
                    '⚖️ *Resultado:* retirado do grupo!',
                    '──────────────────'
                ].join('\n')

                await sock.sendMessage(from, { text: cardBan, mentions: mention })

                delete avisos.fotos[from][sender]
                saveAvisos(avisos)
            } catch (errRem) {
                console.error('[ANTI-FOTO] Erro ao remover usuário:', errRem.message)
                await sock.sendMessage(from, {
                    text: `⚠️ @${senderNum} chegou ao 3º aviso de foto, mas não foi possível removê-lo (o bot é administrador?).`,
                    mentions: mention
                })
            }
        } else if (strike === 1) {
            const cardAviso1 = [
                '⚠️ *ADVERTÊNCIA - ANTI-FOTO (1/3)* ',
                '',
                `👤 *Membro:* @${senderNum}`,
                '🚫 *Motivo:* fotos/imagens não são permitidas neste grupo!',
                `📢 *Situação:* Sua foto foi apagada automaticamente.${apagou ? '' : ' (Não foi possível apagar - bot é admin?)'}`,
                '⚠️ *Se repetir:* 2º aviso! (Ao chegar a 3, você é removido)',
                '──────────────────'
            ].join('\n')

            await sock.sendMessage(from, { text: cardAviso1, mentions: mention })
        } else if (strike === 2) {
            const cardAviso2 = [
                '🚨 *ADVERTÊNCIA FINAL - ANTI-FOTO (2/3)* ',
                '',
                `👤 *Membro:* @${senderNum}`,
                '🚫 *Motivo:* fotos/imagens não são permitidas neste grupo!',
                `📢 *Situação:* Sua foto foi apagada automaticamente.${apagou ? '' : ' (Não foi possível apagar - bot é admin?)'}`,
                '🚨 *CUIDADO:* Mais uma foto e você será REMOVIDO NA HORA!',
                '──────────────────'
            ].join('\n')

            await sock.sendMessage(from, { text: cardAviso2, mentions: mention })
        }

        return true
    } catch (err) {
        console.error('[ANTI-FOTO] Erro no processamento:', err)
        return false
    }
}

/**
 * Comando administrativo .antifoto
 */
async function antifotoCommand(sock, msg, from, sender, text) {
    const { getPrefixForChat } = require('../../utils/configManager')
    const prefix = getPrefixForChat ? getPrefixForChat(from) : config.prefix
    const lower = text.trim().toLowerCase()

    if (!lower.startsWith(prefix + 'antifoto')) return false

    const isGroup = from.endsWith('@g.us')
    const reply = (texto, mentions = []) => sock.sendMessage(from, { text: texto, mentions }, { quoted: msg })

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
        await reply('❌ Só administradores podem ajustar o Anti-Foto!')
        return true
    }

    const groupConfig = configManager.loadGroupConfig()
    if (!groupConfig[from]) groupConfig[from] = {}

    const args = text.trim().split(/\s+/)
    const subCmd = args[1]?.toLowerCase()

    const userName = msg.pushName || 'Administrador'

    if (!subCmd || subCmd === 'ajuda' || subCmd === 'help') {
        const isAtivo = groupConfig[from].antifoto === true || groupConfig[from].antiFoto === true
        const statusTexto = isAtivo ? '🟢 ATIVADO' : '🔴 DESATIVADO'

        const header = [
            '🛡️ *PROTEÇÃO ANTI-FOTO* ',
            `Olá, ${userName}!`,
            `Situação: *${statusTexto}*`,
            '──────────────────'
        ].join('\n')

        const bloco = [
            '*⚙️ O QUE VOCÊ PODE FAZER*',
            '',
            `▸ ${prefix}antifoto on ➔ Bloquear fotos`,
            `▸ ${prefix}antifoto off ➔ Liberar fotos`,
            `▸ ${prefix}antifoto status ➔ Consultar regras e situação`,
            `▸ ${prefix}antifoto reset @user ➔ Zerar avisos de alguém`,
            '──────────────────'
        ].join('\n')

        const footer = [
            '🔒 *REGRAS DE FUNCIONAMENTO*',
            '• Fotos são apagadas na hora (incluindo comprovantes).',
            '• 1ª foto = aviso 1 | 2ª foto = aviso 2 | 3ª foto = REMOÇÃO.',
            '• Administradores não são afetados.',
            '──────────────────'
        ].join('\n')

        await reply([header, '', bloco, '', footer].join('\n'))
        return true
    }

    if (subCmd === 'status') {
        const isAtivo = groupConfig[from].antifoto === true || groupConfig[from].antiFoto === true

        const cardStatus = [
            '🛡️ *SITUAÇÃO DO ANTI-FOTO* ',
            '',
            `📸  *Proteção:* ${isAtivo ? '🟢 ATIVADA' : '🔴 DESATIVADA'}`,
            '🗑️  *Ação:* a foto é excluída imediatamente.',
            '⚖️  *Punição:* 2 advertências e remoção no 3º envio.',
            '🔒  *Exceções:* Administradores e Dono.',
            '──────────────────'
        ].join('\n')

        await reply(cardStatus)
        return true
    }

    if (subCmd === 'on' || subCmd === 'ativar') {
        groupConfig[from].antifoto = true
        configManager.saveGroupConfig(groupConfig)

        try { await sock.sendMessage(from, { react: { text: '🛡️', key: msg.key } }) } catch { }

        const cardAtivado = [
            '📸 *ANTI-FOTO LIGADO* ',
            '',
            '✅ O bloqueio de fotos está *ATIVO* neste grupo!',
            '🗑️ Toda imagem enviada por membros será apagada na hora.',
            '🚨 Quem insistir recebe avisos e é removido no 3º envio.',
            '──────────────────'
        ].join('\n')

        await reply(cardAtivado)
        return true
    }

    if (subCmd === 'off' || subCmd === 'desativar' || subCmd === 'of') {
        groupConfig[from].antifoto = false
        configManager.saveGroupConfig(groupConfig)

        try { await sock.sendMessage(from, { react: { text: '⚪', key: msg.key } }) } catch { }

        const cardDesativado = [
            '📸 *ANTI-FOTO DESLIGADO* ',
            '',
            '⚪ O bloqueio de fotos foi *DESLIGADO* neste grupo.',
            'Imagens e comprovantes voltam a ser aceitos normalmente.',
            '──────────────────'
        ].join('\n')

        await reply(cardDesativado)
        return true
    }

    if (subCmd === 'reset') {
        const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
        const avisos = loadAvisos()

        if (args[2]?.toLowerCase() === 'all' || args[2]?.toLowerCase() === 'todos') {
            if (avisos.fotos?.[from]) {
                avisos.fotos[from] = {}
                saveAvisos(avisos)
            }
            await reply('✅ Os avisos de foto deste grupo foram zerados!')
            return true
        }

        if (mentions.length === 0) {
            await reply(`❌ Marque o usuário que deseja resetar!\n\nExemplo: ${prefix}antifoto reset @usuario\nOu: ${prefix}antifoto reset all`)
            return true
        }

        if (avisos.fotos?.[from]) {
            for (const mention of mentions) {
                delete avisos.fotos[from][mention]
            }
            saveAvisos(avisos)
        }

        await reply(`✅ Avisos de foto zerados para o(s) usuário(s) marcado(s)!`, mentions)
        return true
    }

    await reply(`❌ Opção inválida! Digite *${prefix}antifoto* para ver as opções.`)
    return true
}

antifotoCommand.processarAntiFoto = processarAntiFoto
antifotoCommand.antifotoCommand = antifotoCommand

module.exports = antifotoCommand

const config = require('../../../data/config.json')
const fs = require('fs')
const path = require('path')
const { isAdmin } = require('../../utils/baileys')
const { isOwnerCheck } = require('../../utils/baileys')

const configManager = require('../../utils/configManager')

function loadConfig() {
    return configManager.loadGroupConfig()
}

function saveConfig() {
    configManager.saveGroupConfig(true)
}

function loadConcorrentes() {
    return configManager.loadConcorrentes()
}

function saveConcorrentes(data) {
    configManager.saveConcorrentes(data)
}

module.exports = async (sock, msg, from, sender, text) => {
    const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || ''

    const isOwner = isOwnerCheck(sender, msg)

    let adminStatus = isOwner
    if (!isOwner) {
        adminStatus = await isAdmin(sock, from, sender)
    }
    const isAdminUser = adminStatus

    if (text.startsWith(config.prefix + 'get-lid')) {
        let alvoArg = body.slice((config.prefix + 'get-lid').length).trim()
        let alvoNumero = ''

        if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            alvoNumero = msg.message.extendedTextMessage.contextInfo.mentionedJid[0].split('@')[0]
        }

        else if (msg.message?.extendedTextMessage?.contextInfo?.participant) {
            alvoNumero = msg.message.extendedTextMessage.contextInfo.participant.split('@')[0]
        }

        else if (alvoArg) {
            alvoNumero = alvoArg.replace(/\D/g, '')
        }

        if (!alvoNumero) {
            await sock.sendMessage(from, {
                text: `⚠️ *USO CORRETO*\n──────────────────\n▸ Envie o número, marque alguém ou responda a uma mensagem!\n──────────────────\n▸ Ex: .get-lid 25884...\n──────────────────`
            }, { quoted: msg })
            return true
        }

        try {
            const metadata = await sock.groupMetadata(from)
            const participant = metadata.participants.find(p => p.id.includes(alvoNumero))

            if (participant) {

                const jid = participant.id

                await sock.sendMessage(from, {
                    text: `📱 *CONTATO*\n──────────────────\n▸ 📱 Contato: ${alvoNumero}\n▸ 🔖 *JID/LID:* ${jid.split('@')[0]}\n──────────────────`
                }, { quoted: msg })
            } else {

                const [result] = await sock.onWhatsApp(alvoNumero + '@s.whatsapp.net')
                if (result && result.exists) {
                    const jid = result.jid
                    const lid = jid.split('@')[0]
                    await sock.sendMessage(from, {
                        text: `⚠️ *FORA DO GRUPO*\n──────────────────\n▸ 📱 *Número:* ${alvoNumero}\n▸ 🔖 *ID:* ${lid}\n──────────────────\n▸ _Guarde este ID para ajustes._\n──────────────────`
                    }, { quoted: msg })
                } else {
                    await sock.sendMessage(from, { text: '❌ Número sem conta no WhatsApp.' }, { quoted: msg })
                }
            }
        } catch (err) {
            await sock.sendMessage(from, { text: '❌ Falha ao consultar o ID.' }, { quoted: msg })
        }
        return true
    }

    if (text === config.prefix + 'antistatus') {
        const cfg = loadConfig()
        const status = cfg[from]?.antistatus ? '🟢 ATIVADO' : '🔴 DESATIVADO'
        await sock.sendMessage(from, {
            text: `🛡️ *ANTI-STATUS*\n──────────────────\n▸ Situação: ${status}\n──────────────────\n▸ _Para alterar use:_\n▸ .antistatus on\n▸ .antistatus off\n──────────────────`
        }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'antistatus on') {
        if (!isAdminUser) return await sock.sendMessage(from, { text: '❌ Restrito a administradores.' }, { quoted: msg }), true
        const cfg = loadConfig()
        if (!cfg[from]) cfg[from] = {}
        cfg[from].antistatus = true
        saveConfig(cfg)
        await sock.sendMessage(from, {
            text: `✅ *ANTI-STATUS LIGADO*\n──────────────────\n▸ Quem marcar ou compartilhar status no grupo será banido na hora.\n──────────────────`
        }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'antistatus off') {
        if (!isAdminUser) return await sock.sendMessage(from, { text: '❌ Restrito a administradores.' }, { quoted: msg }), true
        const cfg = loadConfig()
        if (!cfg[from]) cfg[from] = {}
        cfg[from].antistatus = false
        saveConfig(cfg)
        await sock.sendMessage(from, {
            text: `❌ *ANTI-STATUS DESLIGADO*\n──────────────────\n▸ Recurso desativado neste grupo.\n──────────────────`
        }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'detectardoc') {
        const cfg = loadConfig()
        const status = cfg[from]?.detectardoc !== false ? '🟢 ATIVADO' : '🔴 DESATIVADO'
        await sock.sendMessage(from, {
            text: `📄 *LEITURA DE DOCUMENTOS (OCR)*\n──────────────────\n▸ Situação: ${status}\n──────────────────\n▸ _Para alterar use:_\n▸ .detectardoc on\n▸ .detectardoc off\n──────────────────`
        }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'detectardoc on') {
        if (!isAdminUser) return await sock.sendMessage(from, { text: '❌ Restrito a administradores.' }, { quoted: msg }), true
        const cfg = loadConfig()
        if (!cfg[from]) cfg[from] = {}
        cfg[from].detectardoc = true
        saveConfig(cfg)
        await sock.sendMessage(from, {
            text: `📄 *LEITURA DE DOCUMENTOS LIGADA*\n──────────────────\n▸ O bot vai procurar recibos em PDFs e imagens enviados como documento.\n──────────────────`
        }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'detectardoc off') {
        if (!isAdminUser) return await sock.sendMessage(from, { text: '❌ Restrito a administradores.' }, { quoted: msg }), true
        const cfg = loadConfig()
        if (!cfg[from]) cfg[from] = {}
        cfg[from].detectardoc = false
        saveConfig(cfg)
        await sock.sendMessage(from, {
            text: `❌ *LEITURA DE DOCUMENTOS DESLIGADA*\n──────────────────\n▸ PDFs e documentos enviados serão ignorados.\n──────────────────`
        }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'antifurtivo') {
        const cfg = loadConfig()
        const status = cfg[from]?.antifurtivo ? '🟢 ATIVADO' : '🔴 DESATIVADO'
        await sock.sendMessage(from, {
            text: `🛡️ *ANTI-FURTIVO*\n──────────────────\n▸ Situação: ${status}\n──────────────────\n▸ _Para alterar use:_\n▸ .antifurtivo on\n▸ .antifurtivo off\n──────────────────`
        }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'antifurtivo on') {
        if (!isAdminUser) return await sock.sendMessage(from, { text: '❌ Restrito a administradores.' }, { quoted: msg }), true
        const cfg = loadConfig()
        if (!cfg[from]) cfg[from] = {}
        cfg[from].antifurtivo = true
        saveConfig(cfg)
        await sock.sendMessage(from, {
            text: `🛡️ *ANTI-FURTIVO LIGADO*\n──────────────────\n▸ Links e redirecionamentos suspeitos serão bloqueados.\n──────────────────`
        }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'antifurtivo off') {
        if (!isAdminUser) return await sock.sendMessage(from, { text: '❌ Restrito a administradores.' }, { quoted: msg }), true
        const cfg = loadConfig()
        if (!cfg[from]) cfg[from] = {}
        cfg[from].antifurtivo = false
        saveConfig(cfg)
        await sock.sendMessage(from, {
            text: `❌ *ANTI-FURTIVO DESLIGADO*\n──────────────────\n▸ Recurso desativado neste grupo.\n──────────────────`
        }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'antipalavrao') {
        const cfg = loadConfig()
        const status = cfg[from]?.antipalavrao ? '🟢 ATIVADO' : '🔴 DESATIVADO'
        await sock.sendMessage(from, {
            text: `🤬 *ANTI-PALAVRÃO*\n──────────────────\n▸ Situação: ${status}\n──────────────────\n▸ _Para alterar use:_\n▸ .antipalavrao on\n▸ .antipalavrao off\n──────────────────`
        }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'antipalavrao on') {
        if (!isAdminUser) return await sock.sendMessage(from, { text: '❌ Restrito a administradores.' }, { quoted: msg }), true
        const cfg = loadConfig()
        if (!cfg[from]) cfg[from] = {}
        cfg[from].antipalavrao = true
        saveConfig(cfg)
        await sock.sendMessage(from, {
            text: `🤬 *ANTI-PALAVRÃO LIGADO*\n──────────────────\n▸ Linguagem imprópria rende avisos ao usuário (3 strikes).\n──────────────────`
        }, { quoted: msg })
        return true
    }

    if (text === config.prefix + 'antipalavrao off') {
        if (!isAdminUser) return await sock.sendMessage(from, { text: '❌ Restrito a administradores.' }, { quoted: msg }), true
        const cfg = loadConfig()
        if (!cfg[from]) cfg[from] = {}
        cfg[from].antipalavrao = false
        saveConfig(cfg)
        await sock.sendMessage(from, {
            text: `❌ *ANTI-PALAVRÃO DESLIGADO*\n──────────────────\n▸ Recurso desativado neste grupo.\n──────────────────`
        }, { quoted: msg })
        return true
    }

    return false
}

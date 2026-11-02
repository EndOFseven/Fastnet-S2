const config = require('../../data/config.json')
const fs = require('fs')
const path = require('path')
const configManager = require('../utils/configManager')

function loadGroupConfig() {
    return configManager.loadGroupConfig()
}

function getDataMocambique() {
    const now = new Date()
    const offset = 2 * 60
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000)
    return new Date(utc + (offset * 60000))
}

function grupoAutorizado(groupId) {
    const groups = loadGroupConfig()
    const grupoInfo = groups[groupId]

    if (!grupoInfo?.authorized) return false

    if (grupoInfo.expiraEm) {
        const agora = getDataMocambique().getTime()
        if (agora >= grupoInfo.expiraEm) return false
    }

    return true
}

module.exports = async (sock, update) => {
    const groupId = update.id

    if (!groupId.endsWith('@g.us')) return

    if (!grupoAutorizado(groupId)) return

    const author = update.author || null
    const authorNumber = author ? author.split('@')[0] : 'Desconhecido'

    const participants = update.participants || []

    for (const participant of participants) {
        const numero = participant.split('@')[0]

        try {
            switch (update.action) {
                case 'add':

                    break

                case 'remove':

                    const groups = loadGroupConfig()
                    const adeusAtivo = groups[groupId]?.adeus

                    if (!adeusAtivo) break

                    const saiuSozinho = !author || author === participant

                    if (saiuSozinho) {

                        await sock.sendMessage(groupId, {
                            text: `👋 *Alguém saiu do grupo!*\n\n👤 @${numero}`,
                            mentions: [participant]
                        })
                    } else {

                        await sock.sendMessage(groupId, {
                            text: `🚪 *Participante removido!*\n\n👤 Removido: @${numero}\n👮 Por: @${authorNumber}`,
                            mentions: [participant, author]
                        })
                    }
                    break

                case 'promote': {
                    const groups = loadGroupConfig()
                    const safeKey = groupId.replace(/\./g, '___dot___')
                    const x9Ativo = Boolean(groups[groupId]?.x9 ?? groups[safeKey]?.x9)

                    if (!x9Ativo) break

                    if (author) {
                        await sock.sendMessage(groupId, {
                            text: `⬆️ *Novo administrador!*\n\n👤 Promovido: @${numero}\n👮 Por: @${authorNumber}`,
                            mentions: [participant, author]
                        })
                    } else {
                        await sock.sendMessage(groupId, {
                            text: `⬆️ *Novo administrador!*\n\n👤 @${numero} subiu para admin!`,
                            mentions: [participant]
                        })
                    }
                    break
                }

                case 'demote': {
                    const groups = loadGroupConfig()
                    const safeKey = groupId.replace(/\./g, '___dot___')
                    const x9Ativo = Boolean(groups[groupId]?.x9 ?? groups[safeKey]?.x9)

                    if (x9Ativo) {
                        if (author) {
                            await sock.sendMessage(groupId, {
                                text: `⬇️ *Administrador removido!*\n\n👤 Rebaixado: @${numero}\n👮 Por: @${authorNumber}`,
                                mentions: [participant, author]
                            })
                        } else {
                            await sock.sendMessage(groupId, {
                                text: `⬇️ *Administrador removido!*\n\n👤 @${numero} deixou de ser admin.`,
                                mentions: [participant]
                            })
                        }
                    }

                    const botNumber = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : ''
                    if (numero === botNumber) {
                        await sock.sendMessage(groupId, {
                            text: `⚠️ *Aviso!* Fui rebaixado e perdi o cargo de administrador.\n\nAlguns comandos vão falhar até eu ser promovido de novo.`
                        })
                    }
                    break
                }
            }
        } catch (err) {
            console.error('[EVENTOS GRUPO] Erro:', err.message)
        }
    }
}

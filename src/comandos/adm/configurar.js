const config = require('../../../data/config.json')
const { isAdmin, isOwnerCheck } = require('../../utils/baileys')
const { contasStore } = require('../../utils/firebaseDataLayer')
const {
    salvarTabelaMegasGrupo,
    salvarTabelaDiariosGrupo,
    salvarTabelaSemanalGrupo,
    salvarTabelaMensalGrupo,
    salvarTabelaDiamanteGrupo,
    salvarTabelaSaldoGrupo,
    obterTabelaMegasGrupo,
    obterTabelaDiariosGrupo,
    obterTabelaSemanalGrupo,
    obterTabelaMensalGrupo,
    obterTabelaDiamanteGrupo,
    obterTabelaSaldoGrupo,
    calcularMegasPorTexto
} = require('../../vendas/tabela')

function loadContas() {
    return contasStore.loadSync() || {}
}

const pendentesTabela = new Map()

const ROTULOS_TIPO = {
    tabela: 'Tabela',
    diarios: 'Tabela Diária',
    semanal: 'Tabela Semanal',
    mensal: 'Tabela Mensal',
    diamante: 'Tabela Diamante',
    saldo: 'Tabela de Saldo'
}

function salvarPorTipo(grupo, tipo, texto) {
    switch (tipo) {
        case 'diarios': return salvarTabelaDiariosGrupo(grupo, texto)
        case 'semanal': return salvarTabelaSemanalGrupo(grupo, texto)
        case 'mensal': return salvarTabelaMensalGrupo(grupo, texto)
        case 'diamante': return salvarTabelaDiamanteGrupo(grupo, texto)
        case 'saldo': return salvarTabelaSaldoGrupo(grupo, texto)
        default: return salvarTabelaMegasGrupo(grupo, texto)
    }
}

function lerPorTipo(grupo, tipo) {
    switch (tipo) {
        case 'diarios': return obterTabelaDiariosGrupo(grupo) || ''
        case 'semanal': return obterTabelaSemanalGrupo(grupo) || ''
        case 'mensal': return obterTabelaMensalGrupo(grupo) || ''
        case 'diamante': return obterTabelaDiamanteGrupo(grupo) || ''
        case 'saldo': return obterTabelaSaldoGrupo(grupo) || ''
        default: return obterTabelaMegasGrupo(grupo) || ''
    }
}

function saveContas(data, targetGroup = null) {
    if (targetGroup) {
        const safeKey = targetGroup.replace(/\./g, '___dot___')
        const groupData = data[targetGroup] || data[safeKey] || { emola: [], mpesa: [] }
        contasStore.patch(safeKey, groupData)
    } else {
        contasStore.save(data, true)
    }
    try {
        const fs = require('fs')
        const path = require('path')
        const localPath = path.join(__dirname, '../../../data/contasAutorizadas.json')
        fs.writeFileSync(localPath, JSON.stringify(data, null, 2), 'utf8')
    } catch {}
}

module.exports = async (sock, msg, from, sender, text) => {
    const rawBody = msg.message?.conversation || msg.message?.extendedTextMessage?.text || text || ''
    const { getPrefixForChat } = require('../../utils/configManager')
    const prefix = getPrefixForChat ? getPrefixForChat(from) : config.prefix
    const userName = msg.pushName || 'Administrador'

    const lowerBody = (rawBody || '').trim().toLowerCase()
    const ehComandoConfig = lowerBody.startsWith(prefix + 'configurar') ||
        String(text || '').trim().toLowerCase().startsWith(prefix + 'configurar')

    const pend = pendentesTabela.get(from)
    if (pend && !ehComandoConfig) {
        if (Date.now() - pend.criadoEm > 10 * 60 * 1000) {
            pendentesTabela.delete(from)
        } else if (!pend.userId || pend.userId === sender) {
            const texto = (rawBody || '').trim()
            if (texto) {
                if (/^cancelar$/i.test(texto)) {
                    pendentesTabela.delete(from)
                    salvarPorTipo(from, pend.tipo, pend.anterior || '')
                    await sock.sendMessage(from, { text: '❌ Configuração cancelada. A tabela anterior foi mantida.' }, { quoted: msg })
                    return true
                }

                const linhas = texto.split('\n').filter(l => l.trim()).length

                if (/^(fim|pronto)$/i.test(texto)) {
                    pendentesTabela.delete(from)
                    await sock.sendMessage(from, {
                        text: `✅ *${ROTULOS_TIPO[pend.tipo] || 'Tabela'} concluída!* (${pend.linhas} linhas)\n👀 Digite *${prefix}tabela* para visualizar.`
                    }, { quoted: msg })
                    return true
                }

                pend.acumulado = pend.acumulado ? pend.acumulado + '\n' + texto : texto
                pend.linhas += linhas
                pend.criadoEm = Date.now()
                salvarPorTipo(from, pend.tipo, pend.acumulado)

                await sock.sendMessage(from, {
                    text: `✅ Parte guardada (${linhas} linhas · total *${pend.linhas}*).\n\n_Envia mais se faltar, ou diga *fim* para concluir._`
                }, { quoted: msg })
                return true
            }
        }
    }

    if (!ehComandoConfig) return false

    const isGroup = from.endsWith('@g.us')
    const isOwner = isOwnerCheck(sender, msg)
    let adminStatus = false
    if (isGroup) {
        try {
            adminStatus = await isAdmin(sock, from, sender)
        } catch (e) {
            console.error('[CONFIGURAR] Erro ao verificar admin:', e.message)
        }
    }

    if (!isOwner && !adminStatus) {
        await sock.sendMessage(from, {
            text: '❌ *Sem permissão!*\n\nSó administradores e o dono ajustam o bot neste grupo.'
        }, { quoted: msg })
        try { await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }) } catch {}
        return true
    }

    if (isGroup) {
        const { verificarGrupoAtivo } = require('./aluguel')
        const cfgManager = require('../../utils/configManager')
        const groups = cfgManager.loadGroupConfig()
        const grupoInfo = groups[from] || groups[from.replace(/\./g, '___dot___')] || groups[from.replace(/___dot___/g, '.')] || {}
        if (!verificarGrupoAtivo(grupoInfo)) {
            await sock.sendMessage(from, {
                text: '🔒 *CONFIGURAÇÃO BLOQUEADA*\n──────────────────\n▸ Este grupo não tem *aluguel/licença ativa*.\n▸ Ative primeiro com `.aluguel <tempo>` (dono) ou `.ativarlicenca <código>`.\n──────────────────'
            }, { quoted: msg })
            try { await sock.sendMessage(from, { react: { text: '🔒', key: msg.key } }) } catch {}
            return true
        }
    }

    const cleanBody = rawBody.substring((prefix + 'configurar').length).trim()

    const mTipoVazio = cleanBody.toLowerCase().match(/^(tabela|di[aá]rios?|semanal|mensal|diamante|saldo)[/ ]*$/)
    if (mTipoVazio) {
        const bruto = mTipoVazio[1].toLowerCase()
        const tipo = bruto.startsWith('di') ? 'diarios' : bruto
        pendentesTabela.set(from, {
            userId: sender,
            tipo,
            anterior: lerPorTipo(from, tipo),
            acumulado: '',
            linhas: 0,
            criadoEm: Date.now()
        })
        await sock.sendMessage(from, {
            text: [
                `📝 *CONFIGURAR ${(ROTULOS_TIPO[tipo] || 'Tabela').toUpperCase()}*`,
                '──────────────────',
                'Envia agora o texto completo da tabela — podes colar em *várias partes* que eu junto tudo.',
                '',
                '✅ Diz *fim* quando terminar · *cancelar* para desistir.',
                '⏳ Tens 10 minutos.'
            ].join('\n')
        }, { quoted: msg })
        return true
    }

    if (!cleanBody || cleanBody.toLowerCase() === 'ajuda' || cleanBody.toLowerCase() === 'help') {
        const header = [
            '🪐 *PAINEL DE CONFIGURAÇÃO* ',
            `Olá, ${userName}!`,
            '_Ajustes e tabelas só deste grupo_',
            '──────────────────'
        ].join('\n')

        const bloco1 = [
            '*📊 1. TABELAS DE MEGAS*',
            '',
            `▸ ${prefix}configurar tabela/[texto da tabela]`,
            `▸ ${prefix}configurar diarios/[texto]`,
            `▸ ${prefix}configurar semanal/[texto]`,
            `▸ ${prefix}configurar mensal/[texto]`,
            `▸ ${prefix}configurar diamante/[texto]`,
            '──────────────────'
        ].join('\n')

        const bloco2 = [
            '*💰 2. TABELA DE SALDO (CRÉDITO)*',
            '',
            `▸ ${prefix}configurar saldo/[texto da tabela]`,
            '──────────────────'
        ].join('\n')

        const bloco3 = [
            '*👀 3. VER TABELAS ATUAIS*',
            '',
            `▸ ${prefix}configurar ver tabela`,
            `▸ ${prefix}configurar ver diarios`,
            `▸ ${prefix}configurar ver semanal`,
            `▸ ${prefix}configurar ver mensal`,
            `▸ ${prefix}configurar ver diamante`,
            `▸ ${prefix}configurar ver saldo`,
            '──────────────────'
        ].join('\n')

        const bloco4 = [
            '*🗑️ 4. APAGAR TABELAS*',
            '',
            `▸ ${prefix}configurar remover tabela`,
            `▸ ${prefix}configurar remover diarios`,
            `▸ ${prefix}configurar remover semanal`,
            `▸ ${prefix}configurar remover mensal`,
            `▸ ${prefix}configurar remover diamante`,
            `▸ ${prefix}configurar remover saldo`,
            '──────────────────'
        ].join('\n')

        const bloco5 = [
            '*💳 5. CONTAS PARA PAGAMENTO*',
            '',
            `▸ ${prefix}configurar E-mola [número] [nome]`,
            `▸ ${prefix}configurar M-Pesa [número] [nome]`,
            `▸ ${prefix}configurar listar`,
            `▸ ${prefix}configurar remover E-mola [número]`,
            `▸ ${prefix}configurar remover M-Pesa [número]`,
            '──────────────────'
        ].join('\n')

        const footer = [
            '🔒 *ISOLAMENTO TOTAL*',
            'O que você define aqui vale apenas para este grupo.',
            '──────────────────'
        ].join('\n')

        const ajuda = [header, '', bloco1, '', bloco2, '', bloco3, '', bloco4, '', bloco5, '', footer].join('\n')

        await sock.sendMessage(from, { text: ajuda }, { quoted: msg })
        return true
    }

    if (/^tabela(?:\/|\s+)/i.test(cleanBody)) {
        let textoTabela = ''
        if (cleanBody.startsWith('tabela/')) {
            textoTabela = cleanBody.substring('tabela/'.length).trim()
        } else if (cleanBody.toLowerCase().startsWith('tabela')) {
            textoTabela = cleanBody.substring('tabela'.length).trim()
        }

        if (!textoTabela) {
            await sock.sendMessage(from, {
                text: [
                    'ℹ️ *COMO CONFIGURAR A TABELA GERAL / UNIFICADA:*',
                    '────────────────────────',
                    `👉 Envie: \`${prefix}configurar tabela/[texto da tabela]\``,
                    '',
                    '*Exemplo:*',
                    `${prefix}configurar tabela/`,
                    '💠 512MB ➜ 11MT',
                    '💠 1GB ➜ 21MT',
                    '💠 2GB ➜ 42MT',
                    '💠 5GB ➜ 105MT'
                ].join('\n')
            }, { quoted: msg })
            return true
        }

        salvarTabelaMegasGrupo(from, textoTabela)

        await sock.sendMessage(from, {
            text: [
                '🪐 *CONFIGURAÇÃO ATUALIZADA* ',
                '',
                '✅  *Tabela Geral salva!*',
                '📊  O bot lê os valores e seções automaticamente.',
                `👀  Digite *${prefix}tabela* para visualizar.`,
                '──────────────────'
            ].join('\n')
        }, { quoted: msg })
        try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }) } catch {}
        return true
    }

    if (/^di[aá]rios?(?:\/|\s+)/i.test(cleanBody)) {
        let textoDiario = cleanBody.replace(/^di[aá]rios?(?:\/|\s+)/i, '').trim()

        if (!textoDiario) {
            await sock.sendMessage(from, {
                text: `ℹ️ Envie: \`${prefix}configurar diarios/[texto da tabela diaria]\`\n\n*Exemplo:*\n${prefix}configurar diarios/\n1024MB = 20MT\n2048MB = 40MT\n3072MB = 60MT`
            }, { quoted: msg })
            return true
        }

        salvarTabelaDiariosGrupo(from, textoDiario)
        await sock.sendMessage(from, {
            text: [
                '🪐 *CONFIGURAÇÃO ATUALIZADA* ',
                '',
                '✅  *Tabela Diária (24h) salva!*',
                `👀  Digite *${prefix}diarios* para visualizar.`,
                '──────────────────'
            ].join('\n')
        }, { quoted: msg })
        try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }) } catch {}
        return true
    }

    if (/^semanal(?:\/|\s+)/i.test(cleanBody)) {
        let textoSemanal = ''
        if (cleanBody.startsWith('semanal/')) {
            textoSemanal = cleanBody.substring('semanal/'.length).trim()
        } else if (cleanBody.toLowerCase().startsWith('semanal')) {
            textoSemanal = cleanBody.substring('semanal'.length).trim()
        }

        if (!textoSemanal) {
            await sock.sendMessage(from, {
                text: `ℹ️ Envie: \`${prefix}configurar semanal/[texto da tabela semanal]\`\n\n*Exemplo:*\n${prefix}configurar semanal/\n857MB ➜ 30MT\n1.7GB ➜ 45MT\n3.4GB ➜ 95MT\n7.2GB ➜ 190MT`
            }, { quoted: msg })
            return true
        }

        salvarTabelaSemanalGrupo(from, textoSemanal)
        await sock.sendMessage(from, {
            text: [
                '🪐 *CONFIGURAÇÃO ATUALIZADA* ',
                '',
                '✅  *Tabela Semanal (7d) salva!*',
                `👀  Digite *${prefix}semanal* para visualizar.`,
                '──────────────────'
            ].join('\n')
        }, { quoted: msg })
        try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }) } catch {}
        return true
    }

    if (/^mensal(?:\/|\s+)/i.test(cleanBody)) {
        let textoMensal = ''
        if (cleanBody.startsWith('mensal/')) {
            textoMensal = cleanBody.substring('mensal/'.length).trim()
        } else if (cleanBody.toLowerCase().startsWith('mensal')) {
            textoMensal = cleanBody.substring('mensal'.length).trim()
        }

        if (!textoMensal) {
            await sock.sendMessage(from, {
                text: `ℹ️ Envie: \`${prefix}configurar mensal/[texto da tabela mensal]\`\n\n*Exemplo:*\n${prefix}configurar mensal/\n2.8GB ➜ 95MT\n7GB ➜ 190MT\n10GB ➜ 290MT\n18GB ➜ 470MT`
            }, { quoted: msg })
            return true
        }

        salvarTabelaMensalGrupo(from, textoMensal)
        await sock.sendMessage(from, {
            text: [
                '🪐 *CONFIGURAÇÃO ATUALIZADA* ',
                '',
                '✅  *Tabela Mensal (30d) salva!*',
                `👀  Digite *${prefix}mensal* para visualizar.`,
                '──────────────────'
            ].join('\n')
        }, { quoted: msg })
        try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }) } catch {}
        return true
    }

    if (/^(diamante|tudotop|tudo top)(?:\/|\s+)/i.test(cleanBody)) {
        let textoDiamante = cleanBody.replace(/^(diamante|tudotop|tudo top)(?:\/|\s+)/i, '').trim()

        if (!textoDiamante) {
            await sock.sendMessage(from, {
                text: `ℹ️ Envie: \`${prefix}configurar diamante/[texto da tabela diamante]\`\n\n*Exemplo:*\n${prefix}configurar diamante/\n450 MT ➜ 11GB + Chamadas ilimitadas + SMS ilimitadas\n900 MT ➜ 22GB + Chamadas ilimitadas + SMS ilimitadas`
            }, { quoted: msg })
            return true
        }

        salvarTabelaDiamanteGrupo(from, textoDiamante)
        await sock.sendMessage(from, {
            text: [
                '🪐 *CONFIGURAÇÃO ATUALIZADA* ',
                '',
                '✅  *Tabela Diamante / Tudo Top salva!*',
                `👀  Digite *${prefix}diamante* para visualizar.`,
                '──────────────────'
            ].join('\n')
        }, { quoted: msg })
        try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }) } catch {}
        return true
    }

    if (/^saldo(?:\/|\s+)/i.test(cleanBody)) {
        let textoSaldo = ''
        if (cleanBody.startsWith('saldo/')) {
            textoSaldo = cleanBody.substring('saldo/'.length).trim()
        } else if (cleanBody.toLowerCase().startsWith('saldo')) {
            textoSaldo = cleanBody.substring('saldo'.length).trim()
        }

        if (!textoSaldo) {
            await sock.sendMessage(from, {
                text: [
                    'ℹ️ *COMO CONFIGURAR A TABELA DE SALDO:*',
                    '────────────────────────',
                    `👉 Envie: \`${prefix}configurar saldo/[texto da tabela de saldo]\``,
                    '',
                    '*Exemplo:*',
                    `${prefix}configurar saldo/`,
                    '💠 50 MT ➜ 50 MT Saldo',
                    '💠 100 MT ➜ 110 MT Saldo',
                    '💠 500 MT ➜ 550 MT Saldo'
                ].join('\n')
            }, { quoted: msg })
            return true
        }

        salvarTabelaSaldoGrupo(from, textoSaldo)

        await sock.sendMessage(from, {
            text: [
                '🪐 *CONFIGURAÇÃO ATUALIZADA* ',
                '',
                '✅  *Tabela de Saldo (Crédito) salva!*',
                '💰  A tabela de saldo deste grupo foi atualizada.',
                `👀  Digite *${prefix}tabelasaldo* para visualizar.`,
                '──────────────────'
            ].join('\n')
        }, { quoted: msg })
        try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }) } catch {}
        return true
    }

    if (cleanBody.toLowerCase() === 'ver tabela' || cleanBody.toLowerCase() === 'vertabela') {
        const tab = obterTabelaMegasGrupo(from)
        if (!tab) {
            await sock.sendMessage(from, {
                text: `ℹ️ Este grupo não tem tabela de megas própria; o bot usa a padrão.\n\nUse \`${prefix}configurar tabela/[texto]\` para criar uma.`
            }, { quoted: msg })
            return true
        }
        await sock.sendMessage(from, {
            text: `📊 *TABELA DE MEGAS DESTE GRUPO:*\n────────────────────────\n${tab}`
        }, { quoted: msg })
        return true
    }

    if (cleanBody.toLowerCase() === 'ver diarios' || cleanBody.toLowerCase() === 'verdiarios' || cleanBody.toLowerCase() === 'ver diario') {
        const tab = obterTabelaDiariosGrupo(from)
        if (!tab) {
            await sock.sendMessage(from, { text: `ℹ️ Sem tabela diária própria. Use \`${prefix}configurar diarios/[texto]\` para cadastrar.` }, { quoted: msg })
            return true
        }
        await sock.sendMessage(from, { text: `📱 *TABELA DIÁRIA (24h):*\n────────────────────────\n${tab}` }, { quoted: msg })
        return true
    }

    if (cleanBody.toLowerCase() === 'ver semanal' || cleanBody.toLowerCase() === 'versemanal') {
        const tab = obterTabelaSemanalGrupo(from)
        if (!tab) {
            await sock.sendMessage(from, { text: `ℹ️ Sem tabela semanal própria. Use \`${prefix}configurar semanal/[texto]\` para cadastrar.` }, { quoted: msg })
            return true
        }
        await sock.sendMessage(from, { text: `📦 *TABELA SEMANAL (7d):*\n────────────────────────\n${tab}` }, { quoted: msg })
        return true
    }

    if (cleanBody.toLowerCase() === 'ver mensal' || cleanBody.toLowerCase() === 'vermensal') {
        const tab = obterTabelaMensalGrupo(from)
        if (!tab) {
            await sock.sendMessage(from, { text: `ℹ️ Sem tabela mensal própria. Use \`${prefix}configurar mensal/[texto]\` para cadastrar.` }, { quoted: msg })
            return true
        }
        await sock.sendMessage(from, { text: `📦 *TABELA MENSAL (30d):*\n────────────────────────\n${tab}` }, { quoted: msg })
        return true
    }

    if (cleanBody.toLowerCase() === 'ver diamante' || cleanBody.toLowerCase() === 'verdiamante' || cleanBody.toLowerCase() === 'ver tudotop') {
        const tab = obterTabelaDiamanteGrupo(from)
        if (!tab) {
            await sock.sendMessage(from, { text: `ℹ️ Sem tabela diamante própria. Use \`${prefix}configurar diamante/[texto]\` para cadastrar.` }, { quoted: msg })
            return true
        }
        await sock.sendMessage(from, { text: `👑 *TABELA DIAMANTE / TUDO TOP (30d):*\n────────────────────────\n${tab}` }, { quoted: msg })
        return true
    }

    if (cleanBody.toLowerCase() === 'ver saldo' || cleanBody.toLowerCase() === 'versaldo') {
        const tab = obterTabelaSaldoGrupo(from)
        if (!tab) {
            await sock.sendMessage(from, {
                text: `ℹ️ Este grupo não tem tabela de saldo própria.\n\nUse \`${prefix}configurar saldo/[texto]\` para definir a tabela de saldo.`
            }, { quoted: msg })
            return true
        }
        await sock.sendMessage(from, {
            text: `💰 *TABELA DE SALDO DESTE GRUPO:*\n────────────────────────\n${tab}`
        }, { quoted: msg })
        return true
    }

    if (cleanBody.toLowerCase() === 'remover tabela' || cleanBody.toLowerCase() === 'removertabela') {
        salvarTabelaMegasGrupo(from, '')
        await sock.sendMessage(from, {
            text: '🗑️ *Tabela de megas removida!* O grupo usa a tabela padrão de novo.'
        }, { quoted: msg })
        return true
    }
    if (cleanBody.toLowerCase() === 'remover diarios' || cleanBody.toLowerCase() === 'removerdiarios' || cleanBody.toLowerCase() === 'remover diario') {
        salvarTabelaDiariosGrupo(from, '')
        await sock.sendMessage(from, { text: '🗑️ *Tabela diária removida!*' }, { quoted: msg })
        return true
    }
    if (cleanBody.toLowerCase() === 'remover semanal' || cleanBody.toLowerCase() === 'recoversemanal') {
        salvarTabelaSemanalGrupo(from, '')
        await sock.sendMessage(from, { text: '🗑️ *Tabela semanal removida!*' }, { quoted: msg })
        return true
    }
    if (cleanBody.toLowerCase() === 'remover mensal' || cleanBody.toLowerCase() === 'removermensal') {
        salvarTabelaMensalGrupo(from, '')
        await sock.sendMessage(from, { text: '🗑️ *Tabela mensal removida!*' }, { quoted: msg })
        return true
    }
    if (cleanBody.toLowerCase() === 'remover diamante' || cleanBody.toLowerCase() === 'removerdiamante') {
        salvarTabelaDiamanteGrupo(from, '')
        await sock.sendMessage(from, { text: '🗑️ *Tabela diamante removida!*' }, { quoted: msg })
        return true
    }

    if (cleanBody.toLowerCase() === 'listar') {
        const contas = loadContas()
        const grupoContas = contas[from] || { emola: [], mpesa: [] }

        let lista = `📋 *CONTAS DESTE GRUPO*\n────────────────────────\n\n`
        lista += `💠 *E-MOLA:*\n`
        if (grupoContas.emola && grupoContas.emola.length > 0) {
            grupoContas.emola.forEach((c, i) => {
                lista += `  ${i + 1}. ${c.numero} - ${c.nome}\n`
            })
        } else {
            lista += `  _Sem contas cadastradas_\n`
        }

        lista += `\n📲 *M-PESA:*\n`
        if (grupoContas.mpesa && grupoContas.mpesa.length > 0) {
            grupoContas.mpesa.forEach((c, i) => {
                lista += `  ${i + 1}. ${c.numero} - ${c.nome}\n`
            })
        } else {
            lista += `  _Sem contas cadastradas_\n`
        }

        await sock.sendMessage(from, { text: lista.trim() }, { quoted: msg })
        return true
    }

    const emolaMatch = cleanBody.match(/^e-?mola\s+(\d+)\s+(.+)/i)
    if (emolaMatch) {
        const numero = emolaMatch[1]
        const nome = emolaMatch[2].trim()

        const contas = loadContas()
        if (!contas[from]) contas[from] = { emola: [], mpesa: [] }
        if (!contas[from].emola) contas[from].emola = []

        const existe = contas[from].emola.find(c => c.numero === numero)
        if (existe) {
            await sock.sendMessage(from, { text: '⚠️ Esta conta E-mola já existe neste grupo!' }, { quoted: msg })
            return true
        }

        contas[from].emola.push({ numero, nome, addedAt: new Date().toISOString() })
        saveContas(contas, from)


        await sock.sendMessage(from, {
            text: [
                '💳 *CONTA CONFIGURADA* ',
                '',
                '✅  *E-Mola cadastrado!*',
                `📱  *Número:* ${numero}`,
                `👤  *Titular:* ${nome}`,
                '──────────────────'
            ].join('\n')
        }, { quoted: msg })
        try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }) } catch {}
        return true
    }

    const mpesaMatch = cleanBody.match(/^m-?pesa\s+(\d+)\s+(.+)/i)
    if (mpesaMatch) {
        const numero = mpesaMatch[1]
        const nome = mpesaMatch[2].trim()

        const contas = loadContas()
        if (!contas[from]) contas[from] = { emola: [], mpesa: [] }
        if (!contas[from].mpesa) contas[from].mpesa = []

        const existe = contas[from].mpesa.find(c => c.numero === numero)
        if (existe) {
            await sock.sendMessage(from, { text: '⚠️ Esta conta M-Pesa já existe neste grupo!' }, { quoted: msg })
            return true
        }

        contas[from].mpesa.push({ numero, nome, addedAt: new Date().toISOString() })
        saveContas(contas, from)


        await sock.sendMessage(from, {
            text: [
                '💳 *CONTA CONFIGURADA* ',
                '',
                '✅  *M-Pesa cadastrado!*',
                `📱  *Número:* ${numero}`,
                `👤  *Titular:* ${nome}`,
                '──────────────────'
            ].join('\n')
        }, { quoted: msg })
        try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }) } catch {}
        return true
    }

    const removerEmolaMatch = cleanBody.match(/^remover\s+e-?mola\s+(\d+)/i)
    if (removerEmolaMatch) {
        const numero = removerEmolaMatch[1]
        const contas = loadContas()
        if (!contas[from] || !contas[from].emola) {
            await sock.sendMessage(from, { text: '❌ Nenhuma conta E-mola cadastrada.' }, { quoted: msg })
            return true
        }

        const index = contas[from].emola.findIndex(c => c.numero === numero)
        if (index === -1) {
            await sock.sendMessage(from, { text: `❌ Conta E-mola *${numero}* não encontrada.` }, { quoted: msg })
            return true
        }

        const removida = contas[from].emola.splice(index, 1)[0]
        saveContas(contas, from)

        await sock.sendMessage(from, {
            text: [
                '🗑️ *CONTA REMOVIDA* ',
                '',
                '🗑️  *E-Mola removido!*',
                `📱  *Número:* ${removida.numero}`,
                `👤  *Titular:* ${removida.nome}`,
                '──────────────────'
            ].join('\n')
        }, { quoted: msg })
        try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }) } catch {}
        return true
    }

    const removerMpesaMatch = cleanBody.match(/^remover\s+m-?pesa\s+(\d+)/i)
    if (removerMpesaMatch) {
        const numero = removerMpesaMatch[1]
        const contas = loadContas()
        if (!contas[from] || !contas[from].mpesa) {
            await sock.sendMessage(from, { text: '❌ Nenhuma conta M-Pesa cadastrada.' }, { quoted: msg })
            return true
        }

        const index = contas[from].mpesa.findIndex(c => c.numero === numero)
        if (index === -1) {
            await sock.sendMessage(from, { text: `❌ Conta M-Pesa *${numero}* não encontrada.` }, { quoted: msg })
            return true
        }

        const removida = contas[from].mpesa.splice(index, 1)[0]
        saveContas(contas, from)

        await sock.sendMessage(from, {
            text: [
                '🗑️ *CONTA REMOVIDA* ',
                '',
                '🗑️  *M-Pesa removido!*',
                `📱  *Número:* ${removida.numero}`,
                `👤  *Titular:* ${removida.nome}`,
                '──────────────────'
            ].join('\n')
        }, { quoted: msg })
        try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }) } catch {}
        return true
    }

    await sock.sendMessage(from, {
        text: `❌ Opção inválida.\n\nUse \`${prefix}configurar\` para ver as opções disponíveis.`
    }, { quoted: msg })
    return true
}

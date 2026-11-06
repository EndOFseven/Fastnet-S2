const config = require('../../../data/config.json')
const { isAdmin, isOwnerCheck } = require('../../utils/baileys')
const { getPrefixForChat, loadGroupConfig, saveGroupConfig } = require('../../utils/configManager')
const { contasStore } = require('../../utils/firebaseDataLayer')
const { obterVinculo } = require('../../auto/vinculo')
const { obterTabelaMegasGrupo } = require('../../vendas/tabela')
const pagamentoAuto = require('../../vendas/pagamentoAuto')
const { verificarGrupoAtivo } = require('../adm/aluguel')

const COMANDOS = ['pagamentoauto', 'pagamentoautomatico']

function chaveGrupo(groups, from) {
    if (groups[from]) return from
    const safe = String(from).replace(/\./g, '___dot___')
    if (groups[safe]) return safe
    return from
}

function grupoIdDaChave(chave) {
    const valor = String(chave || '')
    if (valor.endsWith('@g.us')) return valor
    if (valor.endsWith('@g___dot___us')) return valor.replace('@g___dot___us', '@g.us')
    if (valor.endsWith('@g_us')) return valor.replace('@g_us', '@g.us')
    return ''
}

function contaOficial(grupoId) {
    const contas = contasStore.loadSync() || {}
    const safe = String(grupoId).replace(/\./g, '___dot___')
    const dados = contas[grupoId] || contas[safe] || {}
    return Array.isArray(dados.emola) && dados.emola.length > 0
}

function formatarDataHora(valor) {
    if (!valor) return 'Nao informado'
    return new Date(Number(valor)).toLocaleString('pt-MZ', {
        timeZone: 'Africa/Maputo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    })
}

function textoEstado(prefix, ativo, central, ativadoEm) {
    const pendentes = pagamentoAuto.contarPendentes(central)
    return [
        `*PAGAMENTO AUTOMATICO: ${ativo ? 'ACTIVO' : 'INACTIVO'}*`,
        '',
        `Servidor: ${central || 'Nao vinculado'}`,
        `Activado em: ${formatarDataHora(ativadoEm)}`,
        `Pendentes: ${pendentes}`,
        '',
        `Use *${prefix}pagamentoauto on* para activar.`,
        `Use *${prefix}pagamentoauto off* para desactivar.`,
        '',
        '_A entrega automatica usa o numero Vodacom dentro do campo Conteudo do SMS e-Mola._'
    ].join('\n')
}

function textoAjuda(prefix) {
    return [
        '*PAGAMENTO AUTOMATICO*',
        '',
        `*${prefix}pagamentoauto on* - activar`,
        `*${prefix}pagamentoauto off* - desactivar`,
        `*${prefix}pagamentoauto status* - ver estado`,
        '',
        '_Requer app FastNet 2.3.28 ou superior, servidor vinculado, conta e-Mola e tabela de dados._'
    ].join('\n')
}

async function pagamentoAutoHandler(sock, msg, from, sender, text) {
    const prefix = getPrefixForChat ? getPrefixForChat(from) : (config.prefix || '.')
    const raw = String(text || '').trim()
    const primeiro = raw.split(/\s+/)[0].toLowerCase()
    const nomes = COMANDOS.map(c => `${prefix}${c}`.toLowerCase())
    if (!nomes.includes(primeiro)) return false
    if (!raw.toLowerCase().startsWith(prefix.toLowerCase())) return false

    if (!from.endsWith('@g.us')) {
        await sock.sendMessage(from, { text: 'Este comando so funciona em grupos.' }, { quoted: msg })
        return true
    }

    let isAdm = false
    try { isAdm = await isAdmin(sock, from, sender) } catch {}
    if (!isOwnerCheck(sender, msg) && !isAdm) {
        await sock.sendMessage(from, { text: 'Apenas administradores do grupo ou o Dono do bot podem gerir o pagamento automatico.' }, { quoted: msg })
        return true
    }

    const groups = loadGroupConfig()
    const key = chaveGrupo(groups, from)
    const entry = groups[key] || (groups[key] = {})
    if (!verificarGrupoAtivo(entry)) {
        await sock.sendMessage(from, { text: 'O aluguel deste grupo nao esta activo.' }, { quoted: msg })
        return true
    }

    const vinculo = obterVinculo(from)
    const central = pagamentoAuto.normalizarCodigo(vinculo.centralCode)
    const configuracao = entry.pagamentoAuto && typeof entry.pagamentoAuto === 'object'
        ? entry.pagamentoAuto
        : {}
    const arg = (raw.split(/\s+/)[1] || 'status').toLowerCase()

    if (arg === 'on') {
        if (!central || !vinculo.autoAtivo) {
            await sock.sendMessage(from, {
                text: `Este grupo ainda nao tem servidor conectado. Use *${prefix}vincular <codigo>* primeiro.`
            }, { quoted: msg })
            return true
        }

        const tabela = String(obterTabelaMegasGrupo(from) || '').trim()
        if (!tabela) {
            await sock.sendMessage(from, { text: 'Configure a tabela de dados do grupo antes de activar o pagamento automatico.' }, { quoted: msg })
            return true
        }

        if (!contaOficial(from)) {
            await sock.sendMessage(from, { text: 'Configure pelo menos uma conta e-Mola no grupo antes de activar o pagamento automatico.' }, { quoted: msg })
            return true
        }

        for (const [outraChave, outraEntry] of Object.entries(groups)) {
            if (outraChave === key) continue
            if (!outraEntry?.pagamentoAuto?.ativo) continue
            const outroGrupoId = grupoIdDaChave(outraChave)
            if (!outroGrupoId) continue
            const outroVinculo = obterVinculo(outroGrupoId)
            const outroCentral = pagamentoAuto.normalizarCodigo(outroVinculo.centralCode)
            if (outroCentral && outroCentral === central) {
                await sock.sendMessage(from, {
                    text: `O servidor *${central}* ja tem pagamento automatico activo noutro grupo. Desactive la primeiro.`
                }, { quoted: msg })
                return true
            }
        }

        const agora = Date.now()
        entry.pagamentoAuto = {
            ...configuracao,
            ativo: true,
            ativadoEm: configuracao.ativo && configuracao.ativadoEm ? configuracao.ativadoEm : agora,
            atualizadoEm: agora
        }
        saveGroupConfig(true)

        await sock.sendMessage(from, {
            text: [
                '*PAGAMENTO AUTOMATICO ACTIVADO*',
                '',
                `Servidor: ${central}`,
                `Desde: ${formatarDataHora(entry.pagamentoAuto.ativadoEm)}`,
                '',
                '_Envie um pagamento e-Mola com o numero Vodacom no campo Conteudo do SMS._',
                '_Saldo gera alerta; apenas pacotes de dados sao entregues automaticamente._'
            ].join('\n')
        }, { quoted: msg })
        return true
    }

    if (arg === 'off') {
        entry.pagamentoAuto = {
            ...configuracao,
            ativo: false,
            desativadoEm: Date.now(),
            atualizadoEm: Date.now()
        }
        saveGroupConfig(true)
        await sock.sendMessage(from, { text: '*PAGAMENTO AUTOMATICO DESACTIVADO*\n\nOs pedidos que ja estao em processamento continuam.' }, { quoted: msg })
        return true
    }

    if (arg !== 'status' && arg !== 'estado') {
        await sock.sendMessage(from, { text: textoAjuda(prefix) }, { quoted: msg })
        return true
    }

    await sock.sendMessage(from, {
        text: textoEstado(prefix, configuracao.ativo === true, central, configuracao.ativadoEm)
    }, { quoted: msg })
    return true
}

pagamentoAutoHandler.nome = 'pagamentoauto'
pagamentoAutoHandler.name = 'pagamentoauto'
pagamentoAutoHandler.aliases = ['pagamentoautomatico']
pagamentoAutoHandler.categoria = 'auto'
pagamentoAutoHandler.subcategoria = 'AUTOMACAO'
pagamentoAutoHandler.descricao = 'Activa a entrega automatica de dados a partir de pagamentos e-Mola'
pagamentoAutoHandler.uso = `${config.prefix}pagamentoauto on|off|status`
pagamentoAutoHandler.apenasAdmin = true

module.exports = pagamentoAutoHandler

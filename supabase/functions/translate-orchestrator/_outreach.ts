// Maintainer outreach drafts (concept 2026-11-08, E3): deterministic templates, NO LLM and NO send
// code. A draft is stored as translation_outreach (status 'draft'); only a protected admin may approve
// it and sending is manual (copy + mark as sent), at the public release (docs/translation/PUBLIC-RELEASE.md).

import { attributionLine } from './_io.ts';

export type OutreachKind = 'notify' | 'permission';

export interface OutreachSource {
  id: string;
  lang: string;
  name: string;
  repo_url: string | null;
  license: string;
  license_kind: 'permissive' | 'nc_sa' | 'none' | string;
  attribution: string;
  coverage?: { text_pct?: number; imported?: number; keys?: number } | null;
}

export interface OutreachDraft {
  source_id: string;
  kind: OutreachKind;
  message_lang: string;
  subject: string;
  body: string;
}

const APP_URL = 'https://sc-companion.vercel.app';

/** `none` = no licence → ask first; `nc_sa` / `permissive` → inform. */
export function outreachKind(licenseKind: string): OutreachKind {
  return licenseKind === 'none' ? 'permission' : 'notify';
}

const MESSAGE_LANGS = ['de', 'it', 'pt-BR', 'ja', 'ru', 'fr', 'zh', 'es', 'en'];

/** The maintainer's language = the language of the pack; anything else falls back to English. */
export function messageLang(sourceLang: string): string {
  const l = sourceLang === 'zh-Hans' || sourceLang === 'zh-Hant' ? 'zh' : sourceLang;
  return MESSAGE_LANGS.includes(l) ? l : 'en';
}

interface Tpl {
  hi: string;
  bye: string;
  subjNotify: string;
  subjPermission: string;
  /** What SC Companion is. */
  intro: string;
  /** What we use: {name} {url} {license} {pct} {count}. */
  uses: string;
  credit: string;
  /** Licence statement per kind. */
  licNc: string;
  licPermissive: string;
  askNotify: string;
  /** Permission request: {name} {license}. */
  askPermission: string;
  noUse: string;
}

const T: Record<string, Tpl> = {
  de: {
    hi: 'Hallo {name}-Team,',
    bye: 'Viele Grüße\nDas SC-Companion-Team',
    subjNotify: 'SC Companion: Nutzung Ihrer Star-Citizen-Übersetzung ({name})',
    subjPermission: 'SC Companion: Anfrage zur Nutzung Ihrer Star-Citizen-Übersetzung ({name})',
    intro: 'SC Companion ({app}) ist ein kostenloses Community-Tool für Star Citizen. Die Desktop-App baut die global.ini lokal aus der englischen Originaldatei des Spielers, den offiziellen Übersetzungen von CIG und einer Übersetzungsschicht, und schreibt sie in den Spielordner.',
    uses: 'Wir verwenden Ihre Übersetzung „{name}“ ({url}, Lizenz: {license}) für die Zeilen, die CIG selbst nicht übersetzt: etwa {pct} % der Texte, rund {count} Zeilen. Zeilen, die CIG selbst übersetzt, bleiben bei CIG.',
    credit: 'Namensnennung: In der App und in der Übersetzungsdatei (Zeile Frontend_PU_Version) steht immer: „{line}“.',
    licNc: 'Die daraus entstehende Übersetzungsschicht veröffentlichen wir unter CC-BY-NC-SA 4.0; die App bleibt für diese Sprache kostenlos.',
    licPermissive: 'Wir halten die Bedingungen Ihrer Lizenz ein (Namensnennung und Lizenzhinweis).',
    askNotify: 'Das ist eine Information, keine Bitte um Erlaubnis. Wenn Sie eine andere Namensnennung wünschen oder die Nutzung nicht möchten, antworten Sie einfach – wir passen es an oder nehmen den Text heraus.',
    askPermission: 'Ihre Übersetzung „{name}“ trägt keine freie Lizenz. Dürfen wir sie mit Namensnennung als Grundlage für die Spielübersetzung in SC Companion verwenden? Bitte antworten Sie mit „erlaubt“ oder „nicht erlaubt“, gern mit Bedingungen.',
    noUse: 'Bis zu Ihrer Antwort nutzen wir Ihren Text nicht; in dieser Sprache gibt es bis dahin nur die offiziellen CIG-Übersetzungen.',
  },
  en: {
    hi: 'Hello {name} team,',
    bye: 'Kind regards\nThe SC Companion team',
    subjNotify: 'SC Companion: using your Star Citizen translation ({name})',
    subjPermission: 'SC Companion: request to use your Star Citizen translation ({name})',
    intro: 'SC Companion ({app}) is a free community tool for Star Citizen. Its desktop app builds the global.ini locally from the player\'s own English file, CIG\'s official translations and a translation layer, and writes it into the game folder.',
    uses: 'We use your translation "{name}" ({url}, licence: {license}) for the lines CIG does not translate itself: about {pct}% of the text, around {count} lines. Lines CIG translates itself stay CIG\'s.',
    credit: 'Credit: the app and the translation file (Frontend_PU_Version line) always say: "{line}".',
    licNc: 'We publish the resulting translation layer under CC-BY-NC-SA 4.0; the app stays free for this language.',
    licPermissive: 'We follow the terms of your licence (credit and licence notice).',
    askNotify: 'This is an information, not a request for permission. If you want different credit or do not want the use, just reply and we will adjust it or remove the text.',
    askPermission: 'Your translation "{name}" carries no open licence. May we use it, with credit, as the basis for the game translation in SC Companion? Please reply "granted" or "refused", conditions welcome.',
    noUse: 'Until you answer we do not use your text; until then this language only shows CIG\'s official translations.',
  },
  it: {
    hi: 'Ciao team di {name},',
    bye: 'Cordiali saluti\nIl team di SC Companion',
    subjNotify: 'SC Companion: uso della vostra traduzione di Star Citizen ({name})',
    subjPermission: 'SC Companion: richiesta di utilizzo della vostra traduzione di Star Citizen ({name})',
    intro: 'SC Companion ({app}) è uno strumento gratuito della community per Star Citizen. L\'app desktop crea il global.ini in locale partendo dal file inglese del giocatore, dalle traduzioni ufficiali di CIG e da un livello di traduzione, e lo scrive nella cartella del gioco.',
    uses: 'Usiamo la vostra traduzione "{name}" ({url}, licenza: {license}) per le righe che CIG non traduce: circa il {pct}% dei testi, circa {count} righe. Le righe tradotte da CIG restano quelle di CIG.',
    credit: 'Attribuzione: l\'app e il file di traduzione (riga Frontend_PU_Version) riportano sempre: "{line}".',
    licNc: 'Pubblichiamo il livello di traduzione risultante con licenza CC-BY-NC-SA 4.0; l\'app resta gratuita per questa lingua.',
    licPermissive: 'Rispettiamo i termini della vostra licenza (attribuzione e nota di licenza).',
    askNotify: 'Questa è un\'informazione, non una richiesta di permesso. Se desiderate un\'attribuzione diversa o non volete questo utilizzo, rispondete pure e adegueremo o rimuoveremo il testo.',
    askPermission: 'La vostra traduzione "{name}" non ha una licenza aperta. Possiamo usarla, con attribuzione, come base per la traduzione del gioco in SC Companion? Rispondete "consentito" o "non consentito", anche con condizioni.',
    noUse: 'Fino alla vostra risposta non usiamo il vostro testo; fino ad allora per questa lingua ci sono solo le traduzioni ufficiali di CIG.',
  },
  'pt-BR': {
    hi: 'Olá, equipe {name},',
    bye: 'Atenciosamente\nEquipe SC Companion',
    subjNotify: 'SC Companion: uso da sua tradução de Star Citizen ({name})',
    subjPermission: 'SC Companion: pedido para usar a sua tradução de Star Citizen ({name})',
    intro: 'O SC Companion ({app}) é uma ferramenta gratuita da comunidade para Star Citizen. O app para desktop monta o global.ini localmente a partir do arquivo em inglês do jogador, das traduções oficiais da CIG e de uma camada de tradução, e o grava na pasta do jogo.',
    uses: 'Usamos a sua tradução "{name}" ({url}, licença: {license}) nas linhas que a CIG não traduz: cerca de {pct}% dos textos, aproximadamente {count} linhas. As linhas traduzidas pela CIG continuam sendo as da CIG.',
    credit: 'Crédito: o app e o arquivo de tradução (linha Frontend_PU_Version) sempre informam: "{line}".',
    licNc: 'Publicamos a camada de tradução resultante sob CC-BY-NC-SA 4.0; o app continua gratuito para este idioma.',
    licPermissive: 'Seguimos os termos da sua licença (crédito e aviso de licença).',
    askNotify: 'Isto é um aviso, não um pedido de permissão. Se quiser outro crédito ou não quiser esse uso, basta responder e ajustaremos ou removeremos o texto.',
    askPermission: 'A sua tradução "{name}" não tem licença aberta. Podemos usá-la, com crédito, como base da tradução do jogo no SC Companion? Responda "autorizado" ou "não autorizado", condições são bem-vindas.',
    noUse: 'Até a sua resposta não usamos o seu texto; até lá este idioma mostra apenas as traduções oficiais da CIG.',
  },
  ja: {
    hi: '{name} チームの皆様へ',
    bye: 'よろしくお願いいたします。\nSC Companion チーム',
    subjNotify: 'SC Companion: Star Citizen 翻訳の利用について（{name}）',
    subjPermission: 'SC Companion: Star Citizen 翻訳の利用許諾のお願い（{name}）',
    intro: 'SC Companion（{app}）は Star Citizen 向けの無料のコミュニティツールです。デスクトップアプリは、プレイヤー自身の英語ファイル、CIG の公式翻訳、翻訳レイヤーから global.ini をローカルで生成し、ゲームフォルダーに書き込みます。',
    uses: '「{name}」（{url}、ライセンス: {license}）を、CIG が自ら翻訳していない行に使用しています。テキストの約 {pct}%、約 {count} 行です。CIG が翻訳した行は CIG のものがそのまま使われます。',
    credit: 'クレジット: アプリと翻訳ファイル（Frontend_PU_Version 行）には常に次の表記が入ります:「{line}」',
    licNc: '生成される翻訳レイヤーは CC-BY-NC-SA 4.0 で公開し、この言語ではアプリは無料のままです。',
    licPermissive: 'ライセンスの条件（クレジットとライセンス表示）を遵守します。',
    askNotify: 'これはお知らせであり、許可のお願いではありません。クレジットの変更や利用の中止をご希望の場合は、ご返信ください。対応するか、テキストを削除します。',
    askPermission: '「{name}」にはオープンなライセンスがありません。クレジットを明記したうえで、SC Companion のゲーム翻訳の基礎として使用してもよろしいでしょうか。「許可」または「不許可」でご返信ください。条件があればお知らせください。',
    noUse: 'ご返信をいただくまで、テキストは使用しません。それまでこの言語では CIG の公式翻訳のみが表示されます。',
  },
  ru: {
    hi: 'Здравствуйте, команда {name}!',
    bye: 'С уважением,\nКоманда SC Companion',
    subjNotify: 'SC Companion: использование вашего перевода Star Citizen ({name})',
    subjPermission: 'SC Companion: просьба разрешить использование вашего перевода Star Citizen ({name})',
    intro: 'SC Companion ({app}) — бесплатный инструмент сообщества для Star Citizen. Настольное приложение собирает global.ini локально из английского файла игрока, официальных переводов CIG и слоя перевода и записывает его в папку игры.',
    uses: 'Мы используем ваш перевод «{name}» ({url}, лицензия: {license}) для строк, которые CIG сама не переводит: около {pct}% текстов, примерно {count} строк. Строки, переведённые CIG, остаются как у CIG.',
    credit: 'Указание авторства: в приложении и в файле перевода (строка Frontend_PU_Version) всегда указано: «{line}».',
    licNc: 'Получившийся слой перевода мы публикуем под лицензией CC-BY-NC-SA 4.0; для этого языка приложение остаётся бесплатным.',
    licPermissive: 'Мы соблюдаем условия вашей лицензии (авторство и указание лицензии).',
    askNotify: 'Это уведомление, а не просьба о разрешении. Если вы хотите иное указание авторства или не согласны с использованием, просто ответьте — мы изменим его или удалим текст.',
    askPermission: 'У вашего перевода «{name}» нет открытой лицензии. Можем ли мы использовать его с указанием авторства как основу игрового перевода в SC Companion? Ответьте «разрешено» или «не разрешено», условия приветствуются.',
    noUse: 'До вашего ответа мы не используем ваш текст; до тех пор для этого языка показываются только официальные переводы CIG.',
  },
  fr: {
    hi: 'Bonjour l\'équipe {name},',
    bye: 'Cordialement,\nL\'équipe SC Companion',
    subjNotify: 'SC Companion : utilisation de votre traduction de Star Citizen ({name})',
    subjPermission: 'SC Companion : demande d\'autorisation pour votre traduction de Star Citizen ({name})',
    intro: 'SC Companion ({app}) est un outil communautaire gratuit pour Star Citizen. L\'application de bureau construit le global.ini en local à partir du fichier anglais du joueur, des traductions officielles de CIG et d\'une couche de traduction, puis l\'écrit dans le dossier du jeu.',
    uses: 'Nous utilisons votre traduction « {name} » ({url}, licence : {license}) pour les lignes que CIG ne traduit pas elle-même : environ {pct} % des textes, soit environ {count} lignes. Les lignes traduites par CIG restent celles de CIG.',
    credit: 'Attribution : l\'application et le fichier de traduction (ligne Frontend_PU_Version) indiquent toujours : « {line} ».',
    licNc: 'Nous publions la couche de traduction obtenue sous licence CC-BY-NC-SA 4.0 ; l\'application reste gratuite pour cette langue.',
    licPermissive: 'Nous respectons les conditions de votre licence (attribution et mention de la licence).',
    askNotify: 'Ceci est une information, pas une demande d\'autorisation. Si vous souhaitez une autre attribution ou refusez cet usage, répondez simplement : nous adapterons ou retirerons le texte.',
    askPermission: 'Votre traduction « {name} » n\'a pas de licence libre. Pouvons-nous l\'utiliser, avec attribution, comme base de la traduction du jeu dans SC Companion ? Merci de répondre « accordé » ou « refusé », avec vos conditions éventuelles.',
    noUse: 'Jusqu\'à votre réponse, nous n\'utilisons pas votre texte ; d\'ici là cette langue n\'affiche que les traductions officielles de CIG.',
  },
  zh: {
    hi: '{name} 团队你好，',
    bye: '此致\nSC Companion 团队',
    subjNotify: 'SC Companion：使用你们的星际公民翻译（{name}）',
    subjPermission: 'SC Companion：申请使用你们的星际公民翻译（{name}）',
    intro: 'SC Companion（{app}）是一款免费的星际公民社区工具。桌面应用会在本地根据玩家自己的英文文件、CIG 官方翻译和一层翻译数据生成 global.ini，并写入游戏文件夹。',
    uses: '我们将你们的翻译“{name}”（{url}，许可：{license}）用于 CIG 自己没有翻译的条目：约占文本的 {pct}%，约 {count} 条。CIG 已翻译的条目仍使用 CIG 的版本。',
    credit: '署名：应用以及翻译文件（Frontend_PU_Version 行）中始终注明：“{line}”。',
    licNc: '由此生成的翻译层以 CC-BY-NC-SA 4.0 发布；该语言的应用保持免费。',
    licPermissive: '我们遵守你们许可证的条款（署名和许可说明）。',
    askNotify: '这是通知，而不是许可请求。如果你们希望更改署名方式或不同意此用途，请直接回复，我们会调整或移除相关文本。',
    askPermission: '你们的翻译“{name}”没有开放许可。我们能否在署名的前提下，将其作为 SC Companion 游戏翻译的基础？请回复“同意”或“不同意”，也欢迎提出条件。',
    noUse: '在收到你们的答复之前，我们不会使用你们的文本；在此之前该语言只显示 CIG 的官方翻译。',
  },
  es: {
    hi: 'Hola, equipo de {name}:',
    bye: 'Un saludo,\nEl equipo de SC Companion',
    subjNotify: 'SC Companion: uso de vuestra traducción de Star Citizen ({name})',
    subjPermission: 'SC Companion: solicitud de permiso para vuestra traducción de Star Citizen ({name})',
    intro: 'SC Companion ({app}) es una herramienta gratuita de la comunidad para Star Citizen. La aplicación de escritorio crea el global.ini en local a partir del archivo en inglés del jugador, las traducciones oficiales de CIG y una capa de traducción, y lo escribe en la carpeta del juego.',
    uses: 'Usamos vuestra traducción "{name}" ({url}, licencia: {license}) para las líneas que CIG no traduce: alrededor del {pct} % de los textos, unas {count} líneas. Las líneas que traduce CIG siguen siendo las de CIG.',
    credit: 'Atribución: la aplicación y el archivo de traducción (línea Frontend_PU_Version) indican siempre: "{line}".',
    licNc: 'Publicamos la capa de traducción resultante bajo CC-BY-NC-SA 4.0; la aplicación sigue siendo gratuita para este idioma.',
    licPermissive: 'Respetamos los términos de vuestra licencia (atribución y aviso de licencia).',
    askNotify: 'Esto es una información, no una solicitud de permiso. Si queréis otra atribución o no queréis este uso, respondednos y lo ajustaremos o retiraremos el texto.',
    askPermission: 'Vuestra traducción "{name}" no tiene una licencia abierta. ¿Podemos usarla, con atribución, como base de la traducción del juego en SC Companion? Responded "permitido" o "no permitido", con las condiciones que queráis.',
    noUse: 'Hasta recibir vuestra respuesta no usamos vuestro texto; hasta entonces este idioma solo muestra las traducciones oficiales de CIG.',
  },
};

function fill(s: string, v: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? `{${k}}`);
}

/** One deterministic draft for a source; same input, same text. */
export function buildOutreachDraft(src: OutreachSource): OutreachDraft {
  const kind = outreachKind(src.license_kind);
  const ml = messageLang(src.lang);
  const t = T[ml] ?? T.en;
  const cov = src.coverage ?? {};
  const pct = cov.text_pct !== undefined && cov.text_pct !== null ? String(cov.text_pct).replace('.', ml === 'de' || ml === 'it' || ml === 'pt-BR' || ml === 'ru' || ml === 'fr' || ml === 'es' ? ',' : '.') : '?';
  const count = cov.imported ?? cov.keys;
  const line = attributionLine(ml === 'de' ? 'de' : 'en', [{
    id: src.id, name: src.name, url: src.repo_url ?? '', license: src.license, attribution: src.attribution || src.name,
  }]);
  const v: Record<string, string> = {
    name: src.name,
    url: src.repo_url ?? '',
    license: src.license || '-',
    pct,
    count: count !== undefined ? String(count) : '?',
    app: APP_URL,
    line,
  };
  const paras: string[] = [fill(t.hi, v), fill(t.intro, v)];
  if (kind === 'permission') {
    paras.push(fill(t.askPermission, v));
    paras.push(fill(t.uses, v), fill(t.credit, v), fill(t.noUse, v));
  } else {
    paras.push(fill(t.uses, v), fill(t.credit, v));
    paras.push(fill(src.license_kind === 'nc_sa' ? t.licNc : t.licPermissive, v), fill(t.askNotify, v));
  }
  paras.push(fill(t.bye, v));
  return {
    source_id: src.id,
    kind,
    message_lang: ml,
    subject: fill(kind === 'permission' ? t.subjPermission : t.subjNotify, v),
    body: paras.join('\n\n'),
  };
}

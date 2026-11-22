/** Locale-owned approval text; the audit reason stays English and verbatim. */

/** English approval message. */
export const en = {
  permissionRequest: (directory: string): string => `Allow writes under ${directory} for this session?`,
}

/** Chinese approval message. */
export const zh = {
  permissionRequest: (directory: string): string => `允许本会话写入 ${directory}？`,
} satisfies typeof en

/** Japanese approval message. */
export const ja = {
  permissionRequest: (directory: string): string => `このセッションで ${directory} への書き込みを許可しますか？`,
} satisfies typeof en

/** Spanish approval message. */
export const es = {
  permissionRequest: (directory: string): string => `¿Permitir escrituras en ${directory} durante esta sesión?`,
} satisfies typeof en

/** French approval message. */
export const fr = {
  permissionRequest: (directory: string): string => `Autoriser les écritures dans ${directory} pour cette session ?`,
} satisfies typeof en

/** German approval message. */
export const de = {
  permissionRequest: (directory: string): string => `Schreibzugriff auf ${directory} für diese Sitzung erlauben?`,
} satisfies typeof en

/** Russian approval message. */
export const ru = {
  permissionRequest: (directory: string): string => `Разрешить запись в ${directory} на время этого сеанса?`,
} satisfies typeof en

/** Portuguese approval message. */
export const pt = {
  permissionRequest: (directory: string): string => `Permitir gravações em ${directory} nesta sessão?`,
} satisfies typeof en

/**
 * Build translations for the Client's localized-text resolver.
 * @param directory - the physical directory the request would grant.
 * @returns approval text per locale.
 */
export function permissionRequestDisplayReason(
  directory: string,
): Record<'en' | 'zh' | 'ja' | 'es' | 'fr' | 'de' | 'ru' | 'pt', string> {
  return {
    en: en.permissionRequest(directory),
    zh: zh.permissionRequest(directory),
    ja: ja.permissionRequest(directory),
    es: es.permissionRequest(directory),
    fr: fr.permissionRequest(directory),
    de: de.permissionRequest(directory),
    ru: ru.permissionRequest(directory),
    pt: pt.permissionRequest(directory),
  }
}

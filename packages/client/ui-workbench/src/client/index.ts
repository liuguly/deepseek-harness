/** Browser half of the personal knowledge workbench: settings section, sidebar opener, and overlay panel. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the layout frame's SlotMap merge ('shell.overlay').
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the sidebar's SlotMap merge ('sidebar.footer.action').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the slots registry's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createWorkbenchApi } from './api.ts'
import { en, zh, type WorkbenchKey } from './locales.ts'
import { WorkbenchController } from './store.ts'
import { WorkbenchOverlay, WorkbenchSection, WorkbenchSidebarAction } from './WorkbenchSection.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Personal knowledge workbench copy. */
    'workbench.knowledge': WorkbenchKey
  }
}

/** Required services for locale registration and the three workbench slots. */
export const inject = ['slots', 'locale']

/** Register the dictionaries, the settings section, the sidebar opener, and the overlay panel. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('workbench.knowledge', { zh, en }), 'ui-workbench: dictionaries')
  const controller = new WorkbenchController(createWorkbenchApi())
  const t = ctx.locale.bind('workbench.knowledge') as (key: WorkbenchKey) => string
  const sectionInject = () => ({
    controller,
    hooks: { state: controller.store },
    t,
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'knowledge',
    order: 40,
    label: () => t('nav'),
    locale: 'workbench.knowledge',
    inject: sectionInject,
  }, WorkbenchSection))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'workbench-open',
    order: 10,
    locale: 'workbench.knowledge',
    inject: () => ({ controller, t }),
  }, WorkbenchSidebarAction))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'workbench-panel',
    order: 100,
    locale: 'workbench.knowledge',
    inject: sectionInject,
  }, WorkbenchOverlay))
}

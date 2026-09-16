
    ctx.effect(function () {
      return slots.inject('conversation.input.left', function () {
        return slots.register({ name: 'conversation.input.left', id: 'dsh-git-idea-chip', order: 10 }, GitChip)
      })
    }, 'dsh-git-idea composer chip')

    ctx.effect(function () {
      return slots.inject('conversation.input.overlay', function () {
        return slots.register({ name: 'conversation.input.overlay', id: 'dsh-git-idea-panel', order: 10 }, GitPopover)
      })
    }, 'dsh-git-idea composer panel')

    /* A page of its own in Settings, between Agent presets (20) and Market (40). */
    ctx.effect(function () {
      return slots.inject('settings.section', function () {
        return slots.register({ name: 'settings.section', id: 'dsh-git-idea', order: 30, label: 'Git' }, GitSettingsSection)
      })
    }, 'dsh-git-idea settings section')
  },
}

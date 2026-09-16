return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) {
      console.error('git panel: the slots Service is unavailable')
      return
    }

    const h = React.createElement


export default function basicCommands(exec, commandFeed) {
  commandFeed.subscribe(({ meta, commandObj }) => {
    const { command, issuer, args } = commandObj;
    // TODO: Token-based auth
    const _exec = exec.bind(issuer, [ meta.id ]);
    // TODO: Centralized error logging
    try {
      _exec(issuer, [meta.id], command, args);
    } catch (e) {
      console.log(e);
    }
  });
}

export function setupUnhandledErrorListeners(): void {
  process.on('unhandledRejection', err => {
    console.error(`Unhandled PROMISE REJECTION ${err}`);
    console.error('Bailing!');
    process.exit(1);
  });

  process.on('uncaughtException', err => {
    console.error(`Unhandled EXCEPTION ${err}`);
    console.error('Bailing!');
    process.exit(1);
  });
}

/** Track a pool before its first connection is created. */
export function trackPoolShutdown(pool) {
  const connections = new Set();
  // pg-pool can resolve end() after removing idle clients from its list, before
  // their sockets close. Track from connect so earlier evictions are covered too.
  pool.on('connect', (client) => {
    const closed = new Promise((resolve) => {
      client.once('end', () => {
        connections.delete(closed);
        resolve();
      });
    });
    connections.add(closed);
  });
  return {
    async end() {
      await pool.end();
      await Promise.all(connections);
    },
  };
}

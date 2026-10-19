/**
 * Ensures BigInt instances serialize cleanly to strings via JSON.stringify
 * globally across Fastify routes and serializers.
 */
if (!('toJSON' in BigInt.prototype)) {
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function (this: bigint) {
      return this.toString();
    },
    writable: true,
    configurable: true,
  });
}

export {};

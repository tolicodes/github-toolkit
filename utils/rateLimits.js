const moment = require('moment');

const setRateLimitOnQueue = (tt, url, reset) => {
  const queue = tt.queues[url];
  if (!queue) return;

  const unblockIn = moment.unix(reset)
    .diff(moment());

  if (unblockIn < 0) {
    console.log('LESS THAN 0', reset);
    return;
  }

  queue.blockQueue(unblockIn);
};

const getRateLimits = async (gt) => {
  const {
    resources,
  } = await gt.request('misc.getRateLimit', null, {
    retry: false,
    noWaitForReady: true,
  });

  if (!resources) return true;

  const allLimits = Object.values(resources).reduce((out, group) => ({
    ...out,
    ...group,
  }), {});

  const ourLimits = Object.entries(allLimits)
    .reduce((out, [ep, { remaining, reset }]) => {
      if (reset && remaining < 1) {
        out[ep] = reset;

        setRateLimitOnQueue(gt, ep, reset);
      }

      return out;
    }, {});

  return ourLimits;
};

module.exports = {
  getRateLimits,
  setRateLimitOnQueue,
};

(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ValuesData = api;
})(typeof window !== 'undefined' ? window : null, function() {
  'use strict';

  function activity(records, helpers) {
    return records.map(record => {
      let feeEstimate;
      if (record.type !== 'TRADE') {
        feeEstimate = {status: 'skip'};
      } else {
        const fee = helpers.computeFeeFor(record);
        if (typeof fee === 'number' && Number.isFinite(fee)) {
          feeEstimate = fee;
        } else {
          feeEstimate = {status: fee !== undefined || helpers.feeUnavailable(record)
            ? 'unavailable' : 'pending'};
        }
      }
      return {
        size: record.size,
        price: record.price,
        usdcSize: record.usdcSize,
        feeEstimate
      };
    });
  }

  function positions(rows, helpers) {
    return rows.map(position => {
      const fee = helpers.positionFeeEstimate(position);
      let feeEstimate;
      if (typeof fee === 'number' && Number.isFinite(fee)) {
        feeEstimate = fee;
      } else {
        const trades = helpers.positionTradesFor(position);
        feeEstimate = {status: fee !== undefined || !trades.length || trades.some(helpers.feeUnavailable)
          ? 'unavailable' : 'pending'};
      }
      return {
        size: position.size,
        avgPrice: position.avgPrice,
        curPrice: position.curPrice,
        initialValue: position.initialValue,
        value: position.isRedeemed ? position.payout : position.currentValue,
        cashPnl: position.cashPnl,
        feeEstimate
      };
    });
  }

  return {activity, positions};
});

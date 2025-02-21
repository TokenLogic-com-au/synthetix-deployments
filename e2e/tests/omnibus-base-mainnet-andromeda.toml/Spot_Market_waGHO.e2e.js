const crypto = require('crypto');
const assert = require('assert');
const { ethers } = require('ethers');
require('../../inspect');
const log = require('debug')(`e2e:${require('path').basename(__filename, '.e2e.js')}`);

const { getEthBalance } = require('../../tasks/getEthBalance');
const { setEthBalance } = require('../../tasks/setEthBalance');
const { getCollateralBalance } = require('../../tasks/getCollateralBalance');
const { getTokenBalance } = require('../../tasks/getTokenBalance');
const { isCollateralApproved } = require('../../tasks/isCollateralApproved');
const { approveCollateral } = require('../../tasks/approveCollateral');
const { setTokenBalance } = require('../../tasks/setTokenBalance');
const { syncTime } = require('../../tasks/syncTime');
const { setConfigUint } = require('../../tasks/setConfigUint');
const { getConfigUint } = require('../../tasks/getConfigUint');
const { wrapCollateral } = require('../../tasks/wrapCollateral');
const { unwrapCollateral } = require('../../tasks/unwrapCollateral');
const { spotSell } = require('../../tasks/spotSell');
const { spotBuy } = require('../../tasks/spotBuy');

describe(require('path').basename(__filename, '.e2e.js'), function () {
  const provider = new ethers.providers.JsonRpcProvider(
    process.env.RPC_URL || 'http://127.0.0.1:8545'
  );
  const wallet = ethers.Wallet.createRandom().connect(provider);
  const address = wallet.address;
  const privateKey = wallet.privateKey;

  let snapshot;
  before('Create snapshot', async () => {
    snapshot = await provider.send('evm_snapshot', []);
    log('Create snapshot', { snapshot });
  });
  after('Restore snapshot', async () => {
    log('Restore snapshot', { snapshot });
    await provider.send('evm_revert', [snapshot]);
  });

  it('should sync time of the fork', async () => {
    await syncTime();
  });

  it('should disable withdrawal timeout', async () => {
    await setConfigUint({ key: 'accountTimeoutWithdraw', value: 0 });
    assert.equal(await getConfigUint('accountTimeoutWithdraw'), 0);
  });

  it('should create new random wallet', async () => {
    log({ wallet: wallet.address, pk: wallet.privateKey });
    assert.ok(wallet.address);
  });

  it('should set ETH balance to 100', async () => {
    assert.equal(await getEthBalance({ address }), 0, 'New wallet has 0 ETH balance');
    await setEthBalance({ address, balance: 100 });
    assert.equal(await getEthBalance({ address }), 100);
  });

  it('should set waBasGHO balance to 100', async () => {
    assert.equal(
      await getCollateralBalance({ address, symbol: 'waBasGHO' }),
      0,
      'New wallet has 0 waBasGHO balance'
    );
    await setTokenBalance({
      wallet,
      balance: 100,
      tokenAddress: require('../../deployments/extras.json').waBasGHO_address,
      friendlyWhale: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
    });
    assert.equal(await getCollateralBalance({ address, symbol: 'waBasGHO' }), 100);
  });

  it('should approve waBasGHO spending for SpotMarket', async () => {
    assert.equal(
      await isCollateralApproved({
        address,
        symbol: 'waBasGHO',
        spenderAddress: require('../../deployments/SpotMarketProxy.json').address,
      }),
      false,
      'New wallet has not allowed SpotMarket waBasGHO spending'
    );
    await approveCollateral({
      privateKey,
      symbol: 'waBasGHO',
      spenderAddress: require('../../deployments/SpotMarketProxy.json').address,
    });
    assert.equal(
      await isCollateralApproved({
        address,
        symbol: 'waBasGHO',
        spenderAddress: require('../../deployments/SpotMarketProxy.json').address,
      }),
      true
    );
  });

  it('should wrap 100 waBasGHO -> sWaGHO', async () => {
    const synthBalance = await wrapCollateral({
      wallet,
      symbol: 'waBasGHO',
      synthAddress: require('../../deployments/extras.json').synth_wa_gho_token_address,
      synthMarketId: require('../../deployments/extras.json').synth_wa_gho_market_id,
      amount: 100,
    });
    assert.equal(synthBalance, 100);
    assert.equal(
      await getTokenBalance({
        walletAddress: address,
        tokenAddress: require('../../deployments/extras.json').synth_wa_gho_token_address,
      }),
      100
    );
  });

  it('should swap 500 sWaGHO -> snxUSD', async () => {
    assert.equal(await getCollateralBalance({ address, symbol: 'snxUSD' }), 0);
    await spotSell({
      wallet,
      marketId: require('../../deployments/extras.json').synth_wa_gho_market_id,
      synthAmount: 50,
      minUsdAmount: 40,
    });
    assert.ok(
      (await getCollateralBalance({ address, symbol: 'snxUSD' })) >= 40,
      'snxUSD balance >= 40'
    );
  });

  it('should approve snxUSD spending for SpotMarket', async () => {
    assert.equal(
      await isCollateralApproved({
        address,
        symbol: 'snxUSD',
        spenderAddress: require('../../deployments/SpotMarketProxy.json').address,
      }),
      false,
      'New wallet has not allowed SpotMarket snxUSD spending'
    );
    await approveCollateral({
      privateKey,
      symbol: 'snxUSD',
      spenderAddress: require('../../deployments/SpotMarketProxy.json').address,
    });
    assert.equal(
      await isCollateralApproved({
        address,
        symbol: 'snxUSD',
        spenderAddress: require('../../deployments/SpotMarketProxy.json').address,
      }),
      true
    );
  });

  it('should swap 40 snxUSD -> sWaGHO', async () => {
    await spotBuy({
      wallet,
      marketId: require('../../deployments/extras.json').synth_wa_gho_market_id,
      usdAmount: 40,
      minAmountReceived: 30,
    });
    assert.ok(
      (await getTokenBalance({
        walletAddress: address,
        tokenAddress: require('../../deployments/extras.json').synth_wa_gho_token_address,
      })) >=
        50 + 30,
      `sWaGHO balance >= ${50 + 30}`
    );
  });

  it('should unwrap 50 sWaGHO -> waBasGHO', async () => {
    const synthBalance = await unwrapCollateral({
      wallet,
      symbol: 'waBasGHO',
      synthAddress: require('../../deployments/extras.json').synth_wa_gho_token_address,
      synthMarketId: require('../../deployments/extras.json').synth_wa_gho_market_id,
      amount: 50,
    });
    assert.ok(synthBalance < 50);
    assert.equal(await getCollateralBalance({ address, symbol: 'waBasGHO' }), 50);
  });
});

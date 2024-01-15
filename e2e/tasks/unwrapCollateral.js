#!/usr/bin/env node

const { ethers } = require('ethers');
const { getCollateralConfig } = require('./getCollateralConfig');
const extras = require('../deployments/extras.json');
const SpotMarketProxyDeployment = require('../deployments/SpotMarketProxy.json');
const { parseError } = require('../parseError');

const log = require('debug')(`e2e:${require('path').basename(__filename, '.js')}`);

async function unwrapCollateral({ wallet, symbol, amount }) {
  const config = await getCollateralConfig(symbol);

  const CollateralToken = new ethers.Contract(
    config.tokenAddress,
    [
      'function decimals() view returns (uint8)',
      'function balanceOf(address account) view returns (uint256)',
    ],
    wallet
  );
  const collateralDecimals = await CollateralToken.decimals();

  const SynthToken = new ethers.Contract(
    extras.synth_usdc_token_address,
    [
      'function symbol() view returns (string)',
      'function decimals() view returns (uint8)',
      'function balanceOf(address account) view returns (uint256)',
    ],
    wallet
  );
  const synthSymbol = await SynthToken.symbol();

  log({
    symbol: synthSymbol,
    oldBalance_synth: parseFloat(
      ethers.utils.formatUnits(await SynthToken.balanceOf(wallet.address))
    ),
    oldBalance_token: parseFloat(
      ethers.utils.formatUnits(await CollateralToken.balanceOf(wallet.address), collateralDecimals)
    ),
  });

  const SpotMarket = new ethers.Contract(
    SpotMarketProxyDeployment.address,
    SpotMarketProxyDeployment.abi,
    wallet
  );

  const args = [
    extras.synth_usdc_market_id,
    ethers.utils.parseUnits(`${amount}`), // Synth
    ethers.utils.parseUnits(`${amount}`, collateralDecimals), // Token, min received
  ];
  log({ args });
  const gas = await SpotMarket.estimateGas.unwrap(...args).catch(parseError);
  const tx = await SpotMarket.unwrap(...args, { gasLimit: gas.mul(2) }).catch(parseError);
  await tx.wait();
  const newBalance_token = parseFloat(
    ethers.utils.formatUnits(await CollateralToken.balanceOf(wallet.address), collateralDecimals)
  );
  const newBalance_synth = parseFloat(
    ethers.utils.formatUnits(await SynthToken.balanceOf(wallet.address))
  );
  log({ newBalance_synth, newBalance_token });
  return newBalance_synth;
}

module.exports = {
  unwrapCollateral,
};

if (require.main === module) {
  require('../inspect');
  const [pk, symbol, amount] = process.argv.slice(2);
  const provider = new ethers.providers.JsonRpcProvider(
    process.env.RPC_URL || 'http://127.0.0.1:8545'
  );
  const wallet = new ethers.Wallet(pk, provider);
  unwrapCollateral({ wallet, symbol, amount }).then(log);
}
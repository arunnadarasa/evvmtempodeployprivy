import fs from 'node:fs/promises';
import { createPublicClient, encodeDeployData, http } from 'viem';
import { tempoModerato } from 'viem/chains';

const BYTECODES_PATH = new URL('../src/lib/contracts/bytecodes.ts', import.meta.url);
const EVVM_ABI_PATH = new URL(
  '../node_modules/@evvm/viem-signature-library/src/abi/Evvm.json',
  import.meta.url
);

const DUMMY_OWNER = '0x2222222222222222222222222222222222222222';
const DUMMY_STAKING = '0x3333333333333333333333333333333333333333';
const DUMMY_LIBRARY = '0x1111111111111111111111111111111111111111';
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const VIRTUAL_TOKEN_ADDR = '0x0000000000000000000000000000000000000001';

function linkBytecode(bytecode, libraryAddress, refs) {
  const addr = libraryAddress.toLowerCase().replace(/^0x/, '');
  let hex = bytecode.replace(/^0x/, '');
  for (const { start, length } of refs) {
    const offset = start * 2;
    const replaceLen = length * 2;
    hex = hex.slice(0, offset) + addr + hex.slice(offset + replaceLen);
  }
  return `0x${hex}`;
}

function extractConst(source, name) {
  const startMarker = `export const ${name} = "`;
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`Missing ${name}`);
  const valueStart = start + startMarker.length;
  const endMarker = '" as `0x${string}`;';
  const end = source.indexOf(endMarker, valueStart);
  if (end === -1) throw new Error(`Missing end marker for ${name}`);
  return source.slice(valueStart, end);
}

function extractLinkRefs(source) {
  const match = source.match(
    /"CoreHashUtils":\s*\[\s*\{\s*"start":\s*(\d+),\s*"length":\s*(\d+)\s*\},\s*\{\s*"start":\s*(\d+),\s*"length":\s*(\d+)\s*\}\s*\]/
  );
  if (!match) throw new Error('Missing CoreHashUtils link refs');
  return [
    { start: Number(match[1]), length: Number(match[2]) },
    { start: Number(match[3]), length: Number(match[4]) },
  ];
}

async function runCase(publicClient, evvmAbi, linkedCoreBytecode, principalTokenAddress, label) {
  const data = encodeDeployData({
    abi: evvmAbi,
    bytecode: linkedCoreBytecode,
    args: [
      DUMMY_OWNER,
      DUMMY_STAKING,
      {
        EvvmName: 'EVVM',
        EvvmID: 0n,
        principalTokenName: 'Mate Token',
        principalTokenSymbol: 'MATE',
        principalTokenAddress,
        totalSupply: 2033333333000000000000000000n,
        eraTokens: 1016666666500000000000000000n,
        reward: 5000000000000000000n,
      },
    ],
  });

  try {
    const gas = await publicClient.estimateGas({
      account: DUMMY_OWNER,
      data,
    });
    console.log(`${label}: ok gas=${gas.toString()} initLen=${data.length}`);
  } catch (error) {
    console.log(`${label}: fail`);
    console.log(error instanceof Error ? error.message : String(error));
  }
}

async function main() {
  const source = await fs.readFile(BYTECODES_PATH, 'utf8');
  const evvmAbiFile = JSON.parse(await fs.readFile(EVVM_ABI_PATH, 'utf8'));
  const EvvmABI = evvmAbiFile.abi;
  const coreBytecode = extractConst(source, 'EVVM_CORE_BYTECODE');
  const refs = extractLinkRefs(source);
  const linkedCoreBytecode = linkBytecode(coreBytecode, DUMMY_LIBRARY, refs);

  const publicClient = createPublicClient({
    chain: tempoModerato,
    transport: http(tempoModerato.rpcUrls.default.http[0]),
  });

  await runCase(
    publicClient,
    EvvmABI,
    linkedCoreBytecode,
    ZERO_ADDR,
    'principalTokenAddress=0x0'
  );
  await runCase(
    publicClient,
    EvvmABI,
    linkedCoreBytecode,
    VIRTUAL_TOKEN_ADDR,
    'principalTokenAddress=0x1'
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

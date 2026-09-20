import { generateKeyPairSync } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { rwaV2Fixture, signRwaV2Fixture } from './fixture.mjs';
import { authorizeIntent, authorizationTypedData, buildAuthorization, buildAuthorizedReceipt, createMemoryStore, signReceipt } from '../../src/index.mjs';
export async function workflowFixture(prior, insight = prior) {
  const signer = privateKeyToAccount('0x'+'12'.repeat(32)), principal = privateKeyToAccount('0x'+'34'.repeat(32));
  const f = rwaV2Fixture(insight), authority = await signRwaV2Fixture(insight,signer,f), execution = await signRwaV2Fixture(insight,signer,f,'1',authority.proof.digest);
  const intent = await prior.buildRwaBoundIntent({transaction:f.transaction,intentId:'simulation-rwa-v2',asset:'eip155:8453/erc20:'+f.input.instrument.tokenAddress,amount:f.input.request.amount,validUntil:f.now+30},authority,f.now);
  const draft = buildAuthorization({intent,principal:{type:'user',id:'simulation-user',account:principal.address},authorizer:{type:'eip712',address:principal.address},delegate:{agentId:'simulation-rwa-agent',executor:f.transaction.from},issuedAt:f.now,notBefore:f.now,expiresAt:intent.validUntil,authorizationNonce:'0x'+'55'.repeat(32),maxUses:'1',audience:'priorseal',policyHash:'0x'+'00'.repeat(32)});
  const authorization = buildAuthorization({...draft,signature:await principal.signTypedData(authorizationTypedData(draft))});
  const keys=generateKeyPairSync('ed25519'), privateKeyPem=keys.privateKey.export({type:'pkcs8',format:'pem'}),publicKeyPem=keys.publicKey.export({type:'spki',format:'pem'});
  const store = createMemoryStore({clock:()=>f.now*1000});
  const accepted = await authorizeIntent({input:authorization,store,privateKeyPem,issuer:'simulation-rwa-v2',keyId:'simulation',now:()=>f.now*1000});
  const acceptanceKey={issuer:'simulation-rwa-v2',keyId:'simulation',algorithm:'Ed25519',publicKey:publicKeyPem,status:'active',validFrom:f.now-60,validUntil:f.now+60};
  const input={intent,authority,execution,authorityTime:f.now,transaction:f.transaction,authorizationId:authorization.authorizationId,audience:'priorseal',acceptanceKey};
  const txHash='0x'+'66'.repeat(32), s=execution.proof.report.semantics;
  const observed={chainId:8453,txHash,status:'CONFIRMED',action:'CONTRACT_CALL',sender:f.transaction.from,recipient:f.transaction.to,target:f.transaction.to,calldataHash:f.input.request.call.calldataHash,nativeValue:'0',asset:intent.asset,amount:intent.amount,nonce:intent.nonce,executedAt:f.now,observedAt:f.now+1,confirmations:12,gasUsed:'100000',transfers:[{asset:s.inputToken,sender:f.transaction.from,recipient:f.transaction.to,amount:s.inputAmount,logIndex:1},{asset:s.outputToken,sender:f.transaction.to,recipient:s.receiver,amount:s.minimumOutput,logIndex:2}],finalityState:'CONFIRMED'};
  const receipt = (observation=observed) => signReceipt(buildAuthorizedReceipt({authorization:accepted.response.authorization,acceptance:accepted.response.acceptance,policyEvidence:accepted.response.policyEvidence,execution:observation,issuer:acceptanceKey.issuer,keyId:acceptanceKey.keyId,issuedAt:f.now+1}),privateKeyPem);
  return {f,signer,principal,authorization,store,accepted,input,txHash,observed,receipt,options:{now:f.now+1,trustedKeys:acceptanceKey}};
}

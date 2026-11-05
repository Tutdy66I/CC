#!/usr/bin/env python3
# Public test domain 0x7f only; this does not create any research seed or sample.
import hashlib, hmac, json, struct, sys

def mac(key, data): return hmac.new(key, data, hashlib.sha256).digest()
def sha(data): return hashlib.sha256(data).digest()
def scenario(cfo_bits, sto):
    out=bytearray(b'SL15SC02')
    out.extend(struct.pack('>HBH',128,4,16))
    out.extend(bytes.fromhex(cfo_bits))
    out.extend(struct.pack('>h',sto))
    out.extend(b'\x00'*8)
    out.extend(bytes.fromhex('3f847ae147ae147b'))
    out.append(3)
    for delay,bits in ((0,'3fec9f25c5bfedd9'),(3,'3fd8c97ef43f7248'),(7,'3fcc9f25c5bfedd9')):
        out.extend(struct.pack('>H',delay));out.extend(bytes.fromhex(bits));out.extend(b'\x00'*8)
    out.extend(bytes.fromhex('3fb999999999999a'));out.extend(struct.pack('>h',2))
    if len(out)!=104: raise ValueError('scenario length')
    return bytes(out)
primitive=mac(bytes([11])*20,b'Hi There')
if primitive.hex()!='b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7': raise ValueError('HMAC primitive')
names=['01-model.json','02-random.json','03-statistics.json','04-numeric.json','05-evidence.json','06-dependencies.json']
records=[]; root_bytes=bytearray(b'SL15PROT03'+struct.pack('>H',len(names)))
for name in names:
    data=('PUBLIC_TEST_ONLY:'+name+'\n').encode('ascii'); nb=name.encode('ascii')
    root_bytes.extend(struct.pack('>H',len(nb)));root_bytes.extend(nb);root_bytes.extend(struct.pack('>Q',len(data)));root_bytes.extend(sha(data))
    records.append({'name':name,'contentHex':data.hex(),'sha256':sha(data).hex()})
root_bytes=bytes(root_bytes); root_hash=sha(root_bytes);manifest_bytes=b'SL15MAN03'+root_bytes+root_hash
test_manifest={'files':records,'rootBytesHex':root_bytes.hex(),'protocolHash':root_hash.hex(),'manifestBytesHex':manifest_bytes.hex(),'manifestHash':sha(manifest_bytes).hex()}
root=bytes(range(32)); phase=b'\x7f'; experiment=bytes.fromhex('00112233445566778899aabbccddeeff')
protocol_bytes=b'SL15 PUBLIC TEST PROTOCOL; NOT FOR RESEARCH\n'; protocol=sha(protocol_bytes)
s0=scenario('0000000000000000',0);s10=scenario('3fc999999999999a',0);s01=scenario('0000000000000000',4);s11=scenario('3fc999999999999a',4)
def draw(name,sc,frame,role,slot,exp=experiment,proto=protocol):
    sid=sha(sc); key=mac(root,b'SL15KEY3'+phase+proto+exp)
    address=b'SL15RNG2'+phase+proto+sid+struct.pack('>Q B I I',frame,role,slot,0)
    if len(address)!=90: raise ValueError('address length')
    digest=mac(key,address); k1=int.from_bytes(digest[:8],'big')>>11;k2=int.from_bytes(digest[8:16],'big')>>11
    return {'name':name,'scenarioId':sid.hex(),'experimentId':exp.hex(),'protocolId':proto.hex(),'frameId':str(frame),'role':role,'slot':slot,'addressHex':address.hex(),'runKeyHex':key.hex(),'digestHex':digest.hex(),'bits2':digest[0]>>6,'k1':str(k1),'k2':str(k2),'u1Binary64':struct.pack('>d',(k1+1)/2**53).hex(),'u2Binary64':struct.pack('>d',k2/2**53).hex()}
alt=bytes.fromhex('00112233445566778899aabbccddee00')
other_protocol=sha(b'SL15 PUBLIC TEST OTHER PROTOCOL\n')
cases=[draw('payload-s00',s0,0,1,80),draw('noise-s00',s0,0,2,0),draw('noise-last-s11',s11,34334,2,1046),draw('payload-next-frame',s0,1,1,80),draw('payload-next-slot',s0,0,1,81),draw('payload-other-experiment',s0,0,1,80,alt),draw('payload-other-scenario',s11,0,1,80),draw('payload-other-protocol',s0,0,1,80,experiment,other_protocol)]
if len({x['digestHex'] for x in cases})!=len(cases):raise ValueError('test domain separation')
result={'testOnly':True,'testPhaseHex':'7f','publicTestRootHex':root.hex(),'testProtocolBytesHex':protocol_bytes.hex(),'testProtocolHash':protocol.hex(),'testOnlyManifest':test_manifest,'scenarios':{'s00':{'binaryHex':s0.hex(),'id':sha(s0).hex()},'s10':{'binaryHex':s10.hex(),'id':sha(s10).hex()},'s01':{'binaryHex':s01.hex(),'id':sha(s01).hex()},'s11':{'binaryHex':s11.hex(),'id':sha(s11).hex()}},'conversionBoundary':{'u1Min':struct.pack('>d',1/2**53).hex(),'u1Max':struct.pack('>d',1.0).hex(),'u2Min':struct.pack('>d',0.0).hex(),'u2Max':struct.pack('>d',(2**53-1)/2**53).hex()},'hmacPrimitiveHex':primitive.hex(),'cases':cases}
with open(sys.argv[1],'x',encoding='utf8',newline='\n') as f: json.dump(result,f,indent=2,ensure_ascii=False);f.write('\n')
print('Python test-only vectors:',len(cases),'scenario bytes:',len(s0),'address bytes: 90')

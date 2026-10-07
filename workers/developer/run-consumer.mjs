import path from 'node:path';
import {createDeveloperOrderGateway} from './gateway.mjs';
import {createRepositoryDeveloperConsumer} from './consumer.mjs';
import {executeBoundedRepositoryOrder} from './bounded-order-executor.mjs';
import {DockerSandbox} from './worker.mjs';

const required=name=>{const value=process.env[name];if(!value)throw Error(`${name} is required`);return value;};
const testFiles=JSON.parse(required('BLACKHOLE_DEVELOPER_TEST_FILES_JSON'));
const allowedRoots=required('BLACKHOLE_DEVELOPER_ALLOWED_ROOTS').split(path.delimiter).filter(Boolean);
const gateway=createDeveloperOrderGateway({origin:required('BLACKHOLE_DEVELOPER_CORE_ORIGIN'),token:required('BLACKHOLE_DEVELOPER_DEVICE_TOKEN')});
const sandbox=new DockerSandbox({imageId:required('BLACKHOLE_DEVELOPER_DOCKER_IMAGE_ID')});
const executor={kind:'pinned-networkless-docker',execute:input=>executeBoundedRepositoryOrder({...input,sandbox})};
const consumer=createRepositoryDeveloperConsumer({gateway,executor,repositoryRoot:required('BLACKHOLE_DEVELOPER_REPOSITORY_ROOT'),allowedRoots,journalDir:required('BLACKHOLE_DEVELOPER_JOURNAL_DIR'),testFiles});
const result=await consumer.runOnce();process.stdout.write(JSON.stringify(result)+'\n');

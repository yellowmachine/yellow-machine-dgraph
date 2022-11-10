import axios from 'axios';
import {promises} from 'fs';
import path from 'path';
import { GraphQLClient } from 'graphql-request';
import jwt from 'jsonwebtoken';
export { gql } from 'graphql-request';

export type Config = {
    url: string, 
    port: string, 
    schema: string,
    claims: string,
    secret: string,
    schemaFooter: (c: Config) => string
};

function requireUncached(module: string) {
    delete require.cache[require.resolve(module)];
    return require(module);
}

export async function dropData(config: Config){
    await axios.post(`${config.url}:${config.port}` + "/alter", {drop_op: "DATA"});
}

export function token(claims: string, config: Config){
    return jwt.sign({ [config.claims]: claims }, config.secret);
}

export function tokenizedGraphQLClient(token: string, config: Config){
    return new GraphQLClient(`${config.url}:${config.port}` + "/graphql", { headers: {Authorization: `Bearer ${token}`} });
}

export function client(claims: string, config: Config){
    return tokenizedGraphQLClient(token(claims, config), config);
}

export const scopedClient = (config: Config) => (claims: string) => client(claims, config);

export function quote(txt: string){
    return `\\"${txt}\\"`;
}

export async function loadSchema(name: string){
    let data = await promises.readFile(name, 'utf8');
    data =  data.toString();
    const lines = data.split("\n");
    let i = 0;
    let line = lines[i];
    let header = "";
    while(line.startsWith("#include")){
      header = header + await loadSchema(path.join(path.dirname(name), line.substring(9).trim())) + "\n";
      i += 1;
      line = lines[i];
    }
    return header + data;
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function dgraph(config: Config){
    return async function(){
        const url = `${config.url}:${config.port}/admin`;
        const name = config.schema;
        
        let data = "";
        try{
            if(name.endsWith(".js")) data = requireUncached(name);
            else data = await loadSchema(name);
        }catch(err){
            console.log(err);
            throw err;
        }
        data = data + config.schemaFooter(config);
        const schema = data.toString();
        console.log(data);
        
        for(;;){       
            const response = await axios({
                url,
                method: 'post',
                data: {
                    query: `mutation($schema: String!) {
                        updateGQLSchema(input: { set: { schema: $schema } }) {
                        gqlSchema {
                            schema
                        }
                        }
                    }`,
                    variables: {
                        schema,
                    },
                },
            });

            if(!response.data.errors){
                break;
            }

            console.log(response.data.errors);
            
            if(!response.data.errors[0].message.startsWith('failed to lazy-load GraphQL schema')){                
                throw new Error(response.data.errors[0].message);
            }
            await sleep(2000);
        }
    };
}

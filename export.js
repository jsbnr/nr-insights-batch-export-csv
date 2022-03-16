
const $http = require("request"); 
const moment = require('moment');
const ExportToCsv  = require('export-to-csv').ExportToCsv;
const fs = require('fs');
const querystring = require('querystring');
const sleep = require('await-sleep')



// Configurations - Change these to your use case
const APIKEY="NR..."                       //Your insights query api key
const ACCOUNTID="1"                        //Your account ID                                         

const QUERY="SELECT timestamp,api,duration from Public_APICall limit max" //your query (dont include since clauses!)
const QUERY_START= moment().subtract(1, 'days')     //since how long ago
const QUERY_END = moment()                          //until when
const BATCH_SIZE = 60*60*24                         //number of seconds of for window size for each batch 60*60*24 == 1 day!


// Probably leave these as they are
const SLEEP_BETWEEN_REQUESTS=500
const DEFAULT_TIMEOUT=5000
const MAX_RESULTS_PER_QUERY=2000




/*
*  ========== SOME HELPER FUNCTIONS ===========================
*/


/*
* asyncForEach()
*
* A handy version of forEach that supports await.
* @param {Object[]} array     - An array of things to iterate over
* @param {function} callback  - The callback for each item
*/
async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
      await callback(array[index], index, array);
    }
  }
  

/*
* genericServiceCall()
* Generic service call helper for commonly repeated tasks
*
* @param {number} responseCodes  - The response code (or array of codes) expected from the api call (e.g. 200 or [200,201])
* @param {Object} options       - The standard http request options object
* @param {function} success     - Call back function to run on successfule request
*/
const  genericServiceCall = function(responseCodes,options) {
    !('timeout' in options) && (options.timeout = DEFAULT_TIMEOUT) //add a timeout if not already specified 
    let possibleResponseCodes=responseCodes
    if(typeof(responseCodes) == 'number') { //convert to array if not supplied as array
      possibleResponseCodes=[responseCodes]
    }
    return new Promise((resolve, reject) => {
        $http(options, function callback(error, response, body) {
        if(error) {
            reject(`Connection error on url '${options.url}'`)
        } else {
            if(!possibleResponseCodes.includes(response.statusCode)) {
                let errmsg=`Expected [${possibleResponseCodes}] response code but got '${response.statusCode}' from url '${options.url}'`
                console.log(body)
                reject(errmsg)
            } else {
                resolve(body,response)
            }
          }
        });
    })
  }


/*
* exportToCSV()
* Exports the data to CSV file, simples.
*
* @param {[Object]} data  - The data to export
*/
const exportToCSV = function(data) {

    let fileName=moment().format("YYYY-MM-DD")+'_NR_Data'
    const options = { 
        fieldSeparator: ',',
        quoteStrings: '"',
        decimalSeparator: '.',
        showLabels: true, 
        showTitle: false,
        useTextFile: false,
        useBom: true,
        useKeysAsHeaders: true,
        filename: fileName
        // headers: ['Column 1', 'Column 2', etc...] <-- Won't work with useKeysAsHeaders present!
      };

    const csvExporter = new ExportToCsv(options);
    const blobData = csvExporter.generateCsv(data,true);
    fs.writeFileSync(`${fileName}.csv`,blobData)
    console.log(`Exported to ${fileName}.csv`) 

}

/*
* constructBatches()
* Batches up the data into multiple requests to be made to insights api.
*
* @param {moment} start     - The start time for the first batch
* @param {moment} end       - The end time for the last batch
* @param {int} size         - The batch size in seconds
* @param {string} query     - The NRQL query
* @param {string} accountID - The Account ID
* @param {string} APIKey    - The API key for account

*/

const constructBatches = function(start,end,size,query,accountID,APIKey) {
    let startTime=moment(start).unix()
    let endTime=moment(end).unix()
    let timeRange=endTime-startTime
    let totalBatches=timeRange/size //the number of batches required

    

    let batchRequests=[]
    for (let batch=0; batch < totalBatches; batch ++) {

        let sinceTime=startTime+(batch*size)
        if(startTime!=sinceTime) {sinceTime+=1} //roll to the next second so no overlap
        let untilTime=sinceTime+size
        if (untilTime > endTime) {
            untilTime=endTime
        }

        let sinceTimeFormatted=moment.unix(sinceTime).format('YYYY-MM-DD HH:mm:ss')
        let untilTimeFormatted=moment.unix(untilTime).format('YYYY-MM-DD HH:mm:ss')

        let qs=querystring.stringify({nrql:`${query} since '${sinceTimeFormatted}' until '${untilTimeFormatted}'`})

        batchRequests.push(
        {
            title: `Batch ${batch}`,
            since: sinceTimeFormatted,
            until: untilTimeFormatted,
            responseCodes: [200],
            request: {
                url: `https://insights-api.newrelic.com/v1/accounts/${accountID}/query?${qs}`,
                method: 'GET',
                headers :{
                  "Accept": "application/json",
                  "X-Query-Key": APIKey
                }
            }
        })
    }

    console.log(`Total Batches: ${batchRequests.length}`)
    return batchRequests
}


/*
*  ========== EXPORT CONTROLLER  ===========================
*/

async function runExport() {

    let TOTALREQUESTS=0,FAILED_REQUESTS=0,COMBINED_RESULTS=[]
    let queries=constructBatches(QUERY_START,QUERY_END,BATCH_SIZE,QUERY,ACCOUNTID,APIKEY)

    console.log(`\n\nBeginning ${queries.length} batch requests...\n`)
    await asyncForEach(queries, async (query) => {
        let options = {...query.request}
        TOTALREQUESTS++
        await sleep(SLEEP_BETWEEN_REQUESTS)
        console.log(`Requesting ${query.title}: ${query.since} until ${query.until}`)
        await genericServiceCall(query.responseCodes,options)
        .then((rawBody)=>{

            try {
                const body=JSON.parse(rawBody)
                if(body.results && body.results[0]) {
                    const events=body.results[0].events
                    query.results=events.length
                    if(events && events.length > 0) {
                        COMBINED_RESULTS.push(...events)
                        if(events.length >=MAX_RESULTS_PER_QUERY) {
                            console.log(`WARN: ${query.title} - Maximum number of events returned (${events.length})`, options.request)
                        }
                    } else {
                        console.log(`WARN: ${query.title} - No events for this query, this might be OK`, options.request,body)
                    }

                } else {
                    FAILED_REQUESTS++
                    console.log(`ERROR: ${query.title} -  No results found in body`,body)
                }
            } catch(e) {
                FAILED_REQUESTS++
                console.log(`ERROR: ${query.title} -  Body JSON parse failed`,rawBody)
            }

        })
        .catch((e)=>{
            FAILED_REQUESTS++
            console.log(`Test '${query.title}' failed with error: ${e} `,true)

        })
    })

    queries.forEach((query)=>{
        console.log(`${query.title}: ${query.since} until ${query.until} - ${query.results}`)
    })


    console.log(`\n\nBatch requests complete`)
    console.log(`Total Request: ${TOTALREQUESTS}`)
    console.log(`Total Failures: ${FAILED_REQUESTS}`)
    console.log(`Total Results: ${COMBINED_RESULTS.length}`)
    console.log(`\n\n`)

    exportToCSV(COMBINED_RESULTS)



    return FAILED_REQUESTS
}


/*
*  ========== RUN THE EXPORT ===========================
*/


runExport().then((failed)=>{
    if(failed > 0 ) {
        console.log('\n\nCompleted with failures') 
    } else {
        console.log('\n\nCompleted successfully') 
    }
})

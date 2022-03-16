# New Relic Batch Insights Data Exporter

Export data using NRQL queries to CSV. Allows you to exceed the 2000 record limit by batching into multiple requests. Useful for occasional data exports for customers. Not to be used for huge or regular data exports!

> **This tool uses the insights query api which will soon be deprecated. Consider using the GraphQL API instead for data querying**


## Usage
Setup the configuration section of the export.js file as required. You will need insights query key. Specify the start and end times and the window size. Ive only tested with simple queries such as `SELECT x, y, z FROM t WHERE u`

Ensure your window size works with your start and end times to ensure that each batch for that window does not exceed 2000 results. You can do that with a timeseries NRQL.

Run with `node export.js`


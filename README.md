# Vision API Comparator
This project shows the different capabilities and responses of Google, Microsoft, and IBM Watson's vision APIs. It works in two _extremely_ loosely connected parts: a batch processor and a results display.

### Installation
Since `node_modules` is ignored by git, first create a `node_modules` directory, then `mv rgbcolor.js node_modules/.` to put that in the right place. You'll then need to run `npm install` to get the rest of what you need. There's a package.json here that will include all the requisite dependencies. (This will take a lot longer than you might think; the APIs often have to install lots of their own dependencies, and even compile things. You may need a FORTRAN compiler [seriously].)

You'll also need to start a local mongodb, as that's where we'll store our results. If you're on a modern Mac, you should be able to do this quite simply: `mongod --rest --jsonp --config /usr/local/etc/mongod.conf`. (The `--rest` and `--jsonp` flags will be used to serve results later on.)

### Batch processor
`image-test.js` is a node application that will use a directory of images you define to blast each of the APIs with each of the images in that directory. *Note:* you will also need to zip your directory into a zipfile of the same name (i.e. if your directory is called "input", use `zip -r input.zip input` to make the appropriate archive).

To run the batch processor, just type `node image-test.js <input-dir>` with no slashes. At the moment, this only works if `image-test.js` is in the same directory as your input directory, so your command line will be something like `node image-test.js pics`.

At this time, image-test.js does not terminate on its own, because of async processing across several APIs being a hellish development issue. When the output of the log reads `Google: inserting for pointer N` (where N = the number of images in your directory) the program should hang; give it a sec to make sure Microsoft is also done (Watson works on the zip file and therefore returns much more predictably) and press `ctrl-c` to quit.

`image-test.js` puts its results into a mongo database, whose location is defined in `mongourl` at the top of the js file.

Note that you must provide the necessary auth tokens in the config.js file. A sample is provided here in the repo; for actual docs / keys, sign up for the relevant accounts (or see the NYTLABS Google Drive).

### Result display
Here I cheated a bit: `result.html` is the file to serve, which reads from the mongo database to show the comparative tags / data. This file also needs access to your original input directory, as above, so that it can serve the images atop the data each API extracted for it.

I haven't done anything fancy to serve this file / these images, so your best bet is to simply go to the directory that contains result.html and your input directory and type `python -m SimpleHTTPServer` to start a local web server, then open `localhost:8000/result.html` to see the results.

### To-do
In making this batch processor it quickly became clear that the actually useful version of this would be a single page, where a user could upload a picture, have that picture analyzed by all three APIs, and have the results come back right in the page. This requires a pretty significant refactoring, so I'll get to this next as a separate initiative. The batch version here is still useful, I think, especially for managing much larger groups of test images.


# LineageTree
A Javascript project to plot hierarchical trees in D3. Designed with fraternity lineages in mind, but could be easily repurposed for other orgs.

## Key Features
* Plot tree using D3's "tidy" tree layout
* Stratify by something other than node depth - i.e. graduation year - while maintaining original parent / child links
* Show information for each node when the box is clicked
* Pan & zoom, with a dragable "minimap" to navigate the tree
* Add a background logo (must be an SVG)
* Text search to locate specific nodes
* Download SVG of tree for refinement / printing (includes in-lining of SVG's CSS styles)

## Implementation
See index.html as an example. There are three steps:

### Initialize a new LineageTree
Add lineagetree.css & lineagetree.js to the page, and in a subsequent script block create a new LineageTree.
```javascript
var tree = new LineageTree(options);
```
Options is an object with keys that configure the LineageTree. Currently there are two configuration options:
* "container" identifies which element to attach the tree to (defaults to "body")
* "logoUrl" is an optional URL for an SVG that will be used as a logo / background image (defaults to null)

### Prepare the tree data
In Google Sheets, create a sheet with all of the members of your tree listed with their parents. The header row should indicate the "name" and "parent" columns.

Then, publish the sheet. This is found in "File" > "Publish to the web..."

Finally, note the sheet ID. This is found in the URL:

```
https://docs.google.com/spreadsheets/d/[SHEET ID]/edit#gid=0
```

### Attach the Google Sheet data
To load the Google Sheet data, we're going to use the Google Sheets JSON API with a callback function defined in the LineageTree prototype. Add the following script to your page *after* the script block where you initialize a new LineageTree.

```html
<script src="https://spreadsheets.google.com/feeds/cells/[SHEET ID]/1/public/values?alt=json-in-script&callback=tree.parseGoogleSheet"></script>
```

Replace [SHEET ID] with the ID of your google sheet. If you named your LineageTree object something other than tree, replace the callback with [your LineageTree object].parseGoogleSheet.

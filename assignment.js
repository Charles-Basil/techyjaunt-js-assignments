
// JAVASCRIPT ASSIGNMENT - TECHYJAUNT


// QUESTION 1
var bunnyFirst = "Lucy";
let dog = "Tom";
const cat = "Molly";

console.log("Question 1:");
console.log("Bunny:", bunnyFirst);
console.log("Dog:", dog);
console.log("Cat:", cat);


// QUESTION 2
console.log("\nQuestion 2:");

console.log("1bunny: invalid");
console.log("_bunny: valid");
console.log("$bunny: valid");
console.log("-bunny: invalid");
console.log("@bunny: invalid");
console.log("bunnyName: valid");

// Correct versions
let bunny1 = "Lucy";
let bunnyName = "Tom";
let bunny_name = "Molly";

console.log("Correct versions:");
console.log("1bunny -> bunny1");
console.log("-bunny -> bunny_name");
console.log("@bunny -> bunnyName");


// QUESTION 3
console.log("\nQuestion 3:");

console.log(pet);
var pet = "lucy";

// The code above prints undefined because var is hoisted
// and initialized with undefined.

// The following code causes a ReferenceError because
// let is hoisted but remains in the temporal dead zone
// until it is initialized.

// console.log(animal);
// let animal = "tom";

console.log(
  "Explanation: var is hoisted and initialized as undefined, while let is hoisted but cannot be accessed before initialization."
);


// QUESTION 4
console.log("\nQuestion 4:");

let globalAnimal = "Bunny";

function animalName() {
  let localAnimal = "Dog";

  console.log("Local variable:", localAnimal);
  console.log("Global variable:", globalAnimal);
}

animalName();

// DATA TYPES

// QUESTION 5
console.log("\nQuestion 5:");

const bunnyObject = {
  name: "Lucy",
  age: 3,
  isHappy: true
};

console.log("Name:", bunnyObject.name);
console.log("Age:", bunnyObject.age);
console.log("Is Happy:", bunnyObject.isHappy);


// QUESTION 6
console.log("\nQuestion 6:");

console.log(3.14, typeof 3.14);
console.log("Lucy", typeof "Lucy");
console.log(true, typeof true);
console.log(null, typeof null);
console.log(undefined, typeof undefined);
console.log(Symbol("Lucy"), typeof Symbol("Lucy"));
console.log({ name: "Lucy" }, typeof { name: "Lucy" });
console.log(["Lucy", "Tom"], typeof ["Lucy", "Tom"]);


// QUESTION 7
console.log("\nQuestion 7:");

const mixedDataTypes = [
  true,
  25,
  "Lucy",
  null,
  undefined,
  { name: "Tom" }
];

console.log("Array:", mixedDataTypes);
console.log("Length:", mixedDataTypes.length);

// FUNCTIONS


// QUESTION 8
console.log("\nQuestion 8:");

function sumBunnies() {
  let blackBunnies = 10;
  let whiteBunnies = 20;

  return blackBunnies + whiteBunnies;
}

console.log(sumBunnies());


// QUESTION 9
console.log("\nQuestion 9:");

function sumBunniesWithParameters(blackBunnies, whiteBunnies) {
  return blackBunnies + whiteBunnies;
}

console.log(sumBunniesWithParameters(10, 20));
console.log(sumBunniesWithParameters(7, 3));


// QUESTION 10
console.log("\nQuestion 10:");

// Anonymous function
const anonymousSum = function (blackBunnies, whiteBunnies) {
  return blackBunnies + whiteBunnies;
};

console.log("Anonymous function:", anonymousSum(10, 20));

// Arrow function
const arrowSum = (blackBunnies, whiteBunnies) => {
  return blackBunnies + whiteBunnies;
};

console.log("Arrow function:", arrowSum(7, 3));


// QUESTION 11
console.log("\nQuestion 11:");

(function () {
  const blackBunnies = 10;
  const whiteBunnies = 20;

  console.log("Total:", blackBunnies + whiteBunnies);
})();


// ARRAYS


// QUESTION 12
console.log("\nQuestion 12:");

const bunnies = ["Lucy", "Tom", "Molly", "Bella", "Max", "Coco"];

bunnies.push("Mario");
bunnies.unshift("Luigi");

const lucyIndex = bunnies.indexOf("Lucy");

if (lucyIndex !== -1) {
  bunnies.splice(lucyIndex, 1);
}

console.log(bunnies);


// QUESTION 13
console.log("\nQuestion 13:");

const bunnyNames = ["Lucy", "Tom", "Molly", "Bella"];

console.log("First item:", bunnyNames[0]);

console.log(
  "Last item:",
  bunnyNames[bunnyNames.length - 1]
);

console.log(
  "Index of Tom:",
  bunnyNames.indexOf("Tom")
);

const bunnyCopy = [...bunnyNames];

console.log("Copy:", bunnyCopy);
console.log("Original:", bunnyNames);


// QUESTION 14
console.log("\nQuestion 14:");

for (let i = 0; i < bunnyNames.length; i++) {
  console.log(
    `Bunny ${bunnyNames[i]} is scheduled for a checkup today.`
  );
}


// QUESTION 15
console.log("\nQuestion 15:");

const nestedArrays = [
  ["Lucy", "Tom"],
  ["Molly", "Bella"]
];

console.log(nestedArrays[0][0]);
console.log(nestedArrays[1][1]);

for (let i = 0; i < nestedArrays.length; i++) {
  for (let j = 0; j < nestedArrays[i].length; j++) {
    console.log(nestedArrays[i][j]);
  }
}

// JSON
// QUESTION 16
console.log("\nQuestion 16:");

const bunny = {
  name: "Lucy",
  age: 3,
  isHappy: true
};

const bunnyJSON = JSON.stringify(bunny);

console.log(bunnyJSON);


// QUESTION 17
console.log("\nQuestion 17:");

let bunnyJSON2 = '{"name":"Lucy","age":3,"isHappy":true}';

const bunnyFromJSON = JSON.parse(bunnyJSON2);

console.log("Name:", bunnyFromJSON.name);
console.log("Age:", bunnyFromJSON.age);

// COMPARISON OPERATORS
// QUESTION 18
console.log("\nQuestion 18:");

let bunny_age = 3;
let dog_age = "3";

console.log("== :", bunny_age == dog_age);
console.log("===:", bunny_age === dog_age);
console.log("!= :", bunny_age != dog_age);
console.log("!==:", bunny_age !== dog_age);

console.log(
  "Explanation: == compares values after type conversion, while === compares both value and data type."
);


// QUESTION 19
console.log("\nQuestion 19:");

const bunniesArray = ["Lucy", "Tom", "Molly"];
const dogsArray = ["Max", "Buddy", "Rocky", "Charlie"];

if (bunniesArray.length <= dogsArray.length) {
  console.log("There are more dogs than bunnies");
} else {
  console.log("There are more bunnies than dogs");
}

// ==========================================
// CONDITIONAL STATEMENTS
// ==========================================

// QUESTION 20
console.log("\nQuestion 20:");

const bunnyHealth = "healthy";

// if / else if / else
if (bunnyHealth === "healthy") {
  console.log("The bunny is healthy");
} else if (bunnyHealth === "sick") {
  console.log("The bunny is sick");
} else {
  console.log("Unknown health status");
}


// switch
switch (bunnyHealth) {
  case "healthy":
    console.log("Switch: The bunny is healthy");
    break;

  case "sick":
    console.log("Switch: The bunny is sick");
    break;

  default:
    console.log("Switch: Unknown health status");
}


// ternary
const healthMessage =
  bunnyHealth === "healthy"
    ? "The bunny is healthy"
    : "The bunny is not healthy";

console.log("Ternary:", healthMessage);


// QUESTION 21
console.log("\nQuestion 21:");

function evenOrOdd(number) {
  return number % 2 === 0 ? "even" : "odd";
}

console.log("4:", evenOrOdd(4));
console.log("7:", evenOrOdd(7));
console.log("0:", evenOrOdd(0));


// ==========================================
// LOOPS
// ==========================================

// QUESTION 22
console.log("\nQuestion 22:");

for (let i = 0; i <= 9; i++) {
  console.log("Number", i);
}

let number = 0;

while (number <= 9) {
  console.log("Number", number);
  number++;
}


// QUESTION 23
console.log("\nQuestion 23:");

// while loop
let countdown = 9;

while (countdown >= 1) {
  console.log(countdown);
  countdown--;
}

// for loop
for (let i = 9; i >= 1; i--) {
  console.log(i);
}


// ==========================================
// EXCEPTION HANDLING AND OPERATORS
// ==========================================

// QUESTION 24
console.log("\nQuestion 24:");

function sumBunniesChecked(blackBunnies, whiteBunnies) {
  if (
    typeof blackBunnies !== "number" ||
    typeof whiteBunnies !== "number"
  ) {
    throw new Error("Both arguments must be numbers");
  }

  return blackBunnies + whiteBunnies;
}

try {
  console.log(sumBunniesChecked(10, "twenty"));
} catch (error) {
  console.log("Error:", error.message);
}


// QUESTION 25
console.log("\nQuestion 25:");

const blackBunnies = 10;
const whiteBunnies = 5;

const totalBunnies = blackBunnies + whiteBunnies;

console.log(
  "Are they equal?",
  blackBunnies === whiteBunnies
);

console.log("Total:", totalBunnies);

console.log(
  "More than 12?",
  totalBunnies > 12
);

console.log(
  totalBunnies > 12 ? "Yes" : "No"
);


// ==========================================
// BRAIN TEASER 1
// ==========================================

console.log("\nBrain Teaser 1:");

let carrots = 3;

while (carrots) {
  console.log("munch");
  carrots--;
}

console.log(
  "The loop prints munch 3 times because carrots decreases from 3 to 0. When carrots becomes 0, the condition becomes false."
);

console.log(
  "If carrots-- were removed, carrots would remain 3 and the loop would run forever."
);

// ==========================================
// BRAIN TEASER 2
// ==========================================

console.log("\nBrain Teaser 2:");

const bunniesForTeaser = [
  "Lucy",
  "Tom",
  "Molly",
  "Bella",
  "Mario",
  "Luigi"
];

// for loop
console.log("Using for loop:");

for (let i = 0; i < bunniesForTeaser.length; i++) {
  if (bunniesForTeaser[i].length > 4) {
    console.log(bunniesForTeaser[i]);
  }
}


// while loop
console.log("Using while loop:");

let i = 0;

while (i < bunniesForTeaser.length) {
  if (bunniesForTeaser[i].length > 4) {
    console.log(bunniesForTeaser[i]);
  }

  i++;
}


// ==========================================
// BRAIN TEASER 3
// ==========================================

console.log("\nBrain Teaser 3:");

const nestedBunnies = [
  ["Lucy", "Tom"],
  ["Molly", "Bella"],
  ["Mario", "Luigi"]
];

let count = 1;

for (let i = 0; i < nestedBunnies.length; i++) {
  for (let j = 0; j < nestedBunnies[i].length; j++) {
    console.log(`${count}. ${nestedBunnies[i][j]}`);
    count++;
  }
}

// ==========================================
// BRAIN TEASER 4
// ==========================================

console.log("\nBrain Teaser 4:");

const happyBunnies = [
  { name: "Lucy", isHappy: true },
  { name: "Tom", isHappy: false },
  { name: "Molly", isHappy: true }
];

function countHappyBunnies(bunnies) {
  let happyCount = 0;

  for (let i = 0; i < bunnies.length; i++) {
    if (bunnies[i].isHappy === true) {
      happyCount++;
    }
  }

  return happyCount;
}

const happyCount = countHappyBunnies(happyBunnies);

console.log("Happy bunnies:", happyCount);

const happyMessage =
  happyCount >= happyBunnies.length / 2
    ? "Most bunnies are happy"
    : "Most bunnies are not happy";

console.log(happyMessage);


// ==========================================
// BRAIN TEASER 5
// ==========================================

console.log("\nBrain Teaser 5:");


// Snippet A
console.log("Snippet A:");

for (let i = 0; i < 5; i++) {
  console.log(i);
}


// Snippet B - fixed
console.log("Snippet B:");

let i2 = 0;

while (i2 < 5) {
  console.log(i2);
  i2++;
}

console.log(
  "Use a for loop when the number of iterations is known; use a while loop when the loop should continue based on a condition."
);
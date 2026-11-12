import {
  ACCEPTANCE_CRITERION,
  CAPABILITY,
  CONSTRAINT,
  FEATURE,
  PURPOSE,
  QUALITY_GOAL,
  REQUIREMENT,
  TARGET_USER,
  USER_STORY,
} from "requirements-engineering";
import { ABSTRACT_TEST, BOUNDARY_STATEMENT, ENTITY_TYPE, OPERATION, WORD_SET } from "test-design";
import type { KindExamples } from "workflow";

// Every example is an item of one invented module, a library's book loans,
// so that the examples of all kinds read as one chain from its purpose to
// its abstract tests. Each trap is an item a writer of the kind it sits
// under would write by mistake: worded like that kind, yet a correct item
// of another kind.

/** An abstract test as it is shown, its steps one per line. */
const test = (...lines: string[]) => lines.join("\n");

/** The examples published with each kind's rules, by kind. */
export const KIND_EXAMPLES: Readonly<Record<string, KindExamples>> = {
  [PURPOSE]: {
    good: { text: "Library members borrow, renew and return books on their own, at any hour, without waiting for a librarian." },
    traps: [
      {
        kind: CAPABILITY,
        text: "Self-service lending: Lets members borrow, renew and return books at any hour without a librarian.",
        why: "This answers which broad ability the module has: \"Lets members borrow…\" names something the module does, not what is different for members once it exists.",
      },
    ],
  },
  [CAPABILITY]: {
    good: { text: "Lending: Lets members borrow, renew and return books, keeping track of who holds each book and until when.", details: "Counts as referencing the purpose." },
    traps: [
      {
        kind: PURPOSE,
        text: "Members get the books they want at any hour, without queuing at a desk.",
        why: "This answers whom the module helps and what changes for them: \"Members get…\" states a difference in members' lives, not an ability the module has.",
      },
      {
        kind: FEATURE,
        text: "Renewals: Extends a member's loan when they need more time with a book.",
        why: "This answers which concrete ability delivers part of a capability: members could still borrow and return books without renewals, so the purpose does not fail for want of it.",
      },
      {
        kind: TARGET_USER,
        text: "librarian: A member of staff who lends books at the desk and takes them back.",
        why: "This answers which kind of person the module changes something for: its name is a role and its description says who they are, not what the module can do.",
      },
    ],
  },
  [FEATURE]: {
    good: { text: "Loan renewal: Extends the due date of a member's loan.", details: "Capability: CAP-01 Lending." },
    traps: [
      {
        kind: TARGET_USER,
        text: "renewing member: A member who keeps a book past its first due date by renewing the loan.",
        why: "This answers which kind of person the module changes something for: \"A member who…\" describes a person, not an ability of the module.",
      },
      {
        kind: CAPABILITY,
        text: "Book circulation: Lends books to members and takes them back, keeping track of who holds each one.",
        why: "This answers which broad ability the purpose cannot be fulfilled without: it gathers lending, taking back and tracking, so it is not one part of a capability but a whole one.",
      },
      {
        kind: USER_STORY,
        text: "As a member, I want a reminder before a loan is due, so that I return books on time.",
        why: "This answers what outcome a kind of person wants from a feature and why: \"As a member, I want … so that\" names a person's wish, not an ability the module has.",
      },
      {
        kind: QUALITY_GOAL,
        text: "Reliability of checkout when the library's network fails, so that members can still borrow books.",
        why: "This answers which quality the module needs and why: \"Reliability of checkout\" asks how well an ability the module already has must hold up, and adds no ability.",
      },
      {
        kind: CONSTRAINT,
        text: "Each member holds at most 10 books at once, set by the library consortium's lending agreement.",
        why: "This answers which limit is set on the module from outside: \"set by the library consortium's lending agreement\" names who imposes it, so it is not an ability the module chose to have.",
      },
    ],
  },
  [TARGET_USER]: {
    good: { text: "member: A person registered with the library who borrows its books." },
    traps: [
      {
        kind: FEATURE,
        text: "Guest borrowing: Lets visitors who are not registered borrow one book at a time.",
        why: "This answers which concrete ability the module has: \"Lets visitors … borrow\" says what the module does for them, not who a kind of person is.",
      },
      {
        kind: CAPABILITY,
        text: "Membership: Registers people with the library and keeps track of who may borrow its books.",
        why: "This answers which broad ability the module has: \"Registers people…\" is something the module does, not a description of a kind of person.",
      },
      {
        kind: USER_STORY,
        text: "As a parent, I want to borrow books for my children on my own card, so that they can read without visiting the library.",
        why: "This answers what outcome a kind of person wants and why: \"I want … so that\" states the parent's wish, while a target user only describes the kind of person.",
      },
      {
        kind: QUALITY_GOAL,
        text: "Readability for members with poor eyesight, so that they can borrow books without help.",
        why: "This answers which quality the module needs and why: \"Readability\" is the quality; the members it mentions only say whom it matters to.",
      },
      {
        kind: CONSTRAINT,
        text: "Members under 16 borrow only with a guardian's written consent, set by the national youth protection law.",
        why: "This answers which limit is set on the module from outside: \"set by the national youth protection law\" marks a rule imposed on what such members may do, not a description of them.",
      },
    ],
  },
  [USER_STORY]: {
    good: {
      text: "As a member, I want to renew a loan before it is due, so that I can finish the book without bringing it back first.",
      details: "Target user: USR-01 member. References FEA-01 Loan renewal.",
    },
    traps: [
      {
        kind: QUALITY_GOAL,
        text: "Quick checkout at busy hours, so that members do not queue behind one another.",
        why: "This answers which quality the module needs and why: \"Quick checkout\" names how well the module must work, and no kind of person wants an outcome from a feature in it.",
      },
      {
        kind: CONSTRAINT,
        text: "Members can see every record the library keeps about them, set by the national data protection law.",
        why: "This answers which limit is set on the module from outside: \"set by the national data protection law\" means it holds whatever members or the spec owner want, so it is not an outcome someone wants.",
      },
      {
        kind: FEATURE,
        text: "Renewal from home: Lets a member renew a loan without coming to the library.",
        why: "This answers which concrete ability the module has: \"Lets a member renew…\" describes what the module does and gives no reason anyone wants it.",
      },
      {
        kind: TARGET_USER,
        text: "student: A member who borrows course books for a few days before each exam.",
        why: "This answers which kind of person the module changes something for: it describes a person's habit, and names no outcome they want from a feature nor why.",
      },
      {
        kind: REQUIREMENT,
        text: "The system must let a member renew a loan at any hour of the day.",
        why: "This answers what the product must do: \"The system must\" states an obligation on the product, not an outcome a person wants and why.",
      },
    ],
  },
  [QUALITY_GOAL]: {
    good: { text: "Reliability of loan records, so that no member is charged for a book they returned." },
    traps: [
      {
        kind: USER_STORY,
        text: "As a member, I want checkout to take only a moment, so that I do not queue behind other members.",
        why: "This answers what outcome a kind of person wants from a feature: \"As a member, I want\" makes it one person's wish, while a quality goal names a quality of the module.",
      },
      {
        kind: CONSTRAINT,
        text: "Every screen meets the WCAG 2.2 AA accessibility standard, set by the city's procurement contract.",
        why: "This answers which limit is set on the module from outside: \"set by the city's procurement contract\" shows a limit the spec owner cannot lift, not a quality the module needs for a reason of its own.",
      },
      {
        kind: FEATURE,
        text: "Offline lending: Lends books while the library's network is down and records the loans once it is back.",
        why: "This answers which concrete ability the module has: \"Lends books while…\" describes something the module does; the quality behind it, reliability, would be the goal.",
      },
      {
        kind: TARGET_USER,
        text: "night-shift worker: A member who can reach the library's services only between midnight and six in the morning.",
        why: "This answers which kind of person the module changes something for: it describes a person; the availability they need would be the quality goal.",
      },
      {
        kind: REQUIREMENT,
        text: "The system must complete a self-service checkout within 2 seconds of the member confirming it.",
        why: "This answers how well the product must do one thing: \"The system must … within 2 seconds\" is an obligation with a limit that can be checked, not the quality and why the module needs it.",
      },
    ],
  },
  [CONSTRAINT]: {
    good: { text: "Records of a member's returned loans are deleted within 30 days of the return, set by the city's data protection regulation." },
    traps: [
      {
        kind: USER_STORY,
        text: "As a member, I want my loan history deleted once I return my books, so that nobody learns what I read.",
        why: "This answers what outcome a member wants and why: it is a wish the spec owner may grant or not, and nothing outside the product sets it.",
      },
      {
        kind: QUALITY_GOAL,
        text: "Privacy of members' reading habits, so that members borrow any book without fear of being watched.",
        why: "This answers which quality the module needs and why: \"so that members borrow…\" gives the module's own reason, and no law, standard or contract imposes it.",
      },
      {
        kind: FEATURE,
        text: "Loan history deletion: Deletes the record of a loan 30 days after the book is returned.",
        why: "This answers which concrete ability the module has: \"Deletes the record…\" is something the module does, and it names no one outside the product who imposes it.",
      },
      {
        kind: TARGET_USER,
        text: "data protection officer: A person who checks that the library handles members' data as the law requires.",
        why: "This answers which kind of person the module changes something for: it describes a person; the law it mentions is what they check, not a limit stated with its source.",
      },
      {
        kind: REQUIREMENT,
        text: "The system must delete the record of a returned loan within 30 days of its return.",
        why: "This answers which limit the product must stay within: \"The system must\" states what the product does to keep within the limit, not the limit set from outside and who sets it.",
      },
    ],
  },
  [REQUIREMENT]: {
    good: {
      text: "The system must set a renewed loan's due date to 21 days after the day of renewal.\nRationale: 21 days is the library's loan period, so a renewal gives a member as long as a new loan does.",
      details: "Type: functional. References US-01.",
    },
    traps: [
      {
        kind: USER_STORY,
        text: "As a member, I want a renewal to give me as long as a new loan, so that I can plan my reading.",
        why: "This answers what outcome a member wants and why: \"I want … so that\" states a person's wish and sets no obligation that can be checked.",
      },
      {
        kind: QUALITY_GOAL,
        text: "Fast renewals, so that members renewing at the desk do not hold up the queue.",
        why: "This answers which quality the module needs and why: \"Fast\" names the quality with no situation and no limit that can be checked, so it states the need, not an obligation.",
      },
      {
        kind: CONSTRAINT,
        text: "Card payments of late fees follow the PCI DSS standard, set by the library's bank.",
        why: "This answers which limit is set on the module from outside: \"set by the library's bank\" names who imposes it, and it does not say what the product must do to stay within it.",
      },
      {
        kind: ACCEPTANCE_CRITERION,
        text: "Given a member's loan whose due date has passed\nWhen the member renews the loan\nThen the renewal is refused",
        why: "This answers which situation, event and outcome show that a requirement is met: its Given, When and Then decide one case, not the obligation itself.",
      },
    ],
  },
  [ACCEPTANCE_CRITERION]: {
    good: { text: "Given a member's loan that is not overdue\nWhen the member renews the loan\nThen the loan has 21 days left until its due date", details: "References REQ-01." },
    traps: [
      {
        kind: REQUIREMENT,
        text: "The system must refuse to renew a loan whose due date has passed.",
        why: "This answers what the product must do: \"The system must\" states the obligation for every case at once, with no situation, event and outcome that decide one case.",
      },
      {
        kind: BOUNDARY_STATEMENT,
        text: [
          "Tests act on and observe: a member's loans and the due dates shown to them, as the member renews and returns books",
          "Every test starts from: a library holding no member, book or loan",
        ].join("\n"),
        why: "This answers what the module's tests act on and start from: it holds for all criteria at once and decides no case of any requirement.",
      },
      {
        kind: ENTITY_TYPE,
        text: "Reservation: A member's claim on a book that is on loan, honoured when the book comes back.",
        why: "This answers which thing a test gets as a step's result and refers to by name: it says what a reservation is, and states no situation, event or outcome.",
      },
      {
        kind: WORD_SET,
        text: "Renewal outcome: granted, refused as overdue, refused as reserved",
        why: "This answers which words a value can be: it lists the outcomes a renewal can have, without the situation and event that lead to one of them.",
      },
      {
        kind: OPERATION,
        text: 'Action "member renews": the member renews {loan}\nInputs: loan, Loan\nResult: none\nRefusals: overdue, meaning the loan\'s due date has passed',
        why: "This answers what a test can do at the boundary: a phrase with a place {loan}, a typed input and declared refusals describe a step, not the outcome that shows a requirement is met.",
      },
      {
        kind: ABSTRACT_TEST,
        text: test(
          "Verifies AC-02: Given a member's loan whose due date has passed When the member renews the loan Then the renewal is refused and the due date stays as it was",
          "",
          'Given (action) add a book titled "Emma", as emma',
          '  and (action) register a member named "Ben", as ben',
          "  and (action) lend emma to ben, as loan",
          "  and (direct setup) let 22 days pass",
          "When (action) renew loan, as renewal",
          "Then renewal is refused with overdue",
          "  and (observation) the days left on loan equals -1",
        ),
        why: "This answers which steps with which concrete values check one criterion: \"Emma\", \"Ben\" and 22 days are single values, while a criterion states its case so that it holds for every value in it.",
      },
    ],
  },
  [BOUNDARY_STATEMENT]: {
    good: {
      text: [
        "Tests act on and observe: the members, books and loans of one library, and the library's date, through what members and librarians do and see when books are added, borrowed, renewed and returned",
        "They leave out: how members sign in, and the reminders sent to members",
        "Every test starts from: a library holding no member, book or loan",
      ].join("\n"),
    },
    traps: [
      {
        kind: ENTITY_TYPE,
        text: "Library: A collection of books, members and loans under one set of lending rules.",
        why: "This answers which thing a test gets as a step's result and refers to by name: it says what one library is, and nothing of what tests act on, leave out or start from.",
      },
      {
        kind: WORD_SET,
        text: "Area under test: lending, renewing, returning",
        why: "This answers which words a value can be: it is a list of words an input or a result takes, not a statement of what tests act on, leave out and start from.",
      },
      {
        kind: OPERATION,
        text: 'Direct setup "start on date": start the library\'s calendar on {date}\nInputs: date, text\nResult: none\nPut in place directly because no action of the product sets the library\'s date',
        why: "This answers what a test can do at the boundary: it is one step with a typed input that puts a state in place, while the starting state holds before any step, for every test.",
      },
      {
        kind: ACCEPTANCE_CRITERION,
        text: "Given a library holding no member\nWhen a person registers as a member\nThen the library holds one member",
        why: "This answers which situation, event and outcome show that a requirement is met: its When and Then decide one case, while a starting state holds before any event.",
      },
      {
        kind: ABSTRACT_TEST,
        text: test(
          "Verifies AC-04: Given a library holding no member When a person registers as a member Then the library holds one member",
          "",
          'When (action) register a member named "Ana"',
          "Then (observation) the number of members equals 1",
        ),
        why: "This answers which steps check one criterion: it starts from the starting state and checks one criterion with \"Ana\", rather than stating where every test starts.",
      },
    ],
  },
  [ENTITY_TYPE]: {
    good: { text: "Loan: One book lent to one member until a due date." },
    traps: [
      {
        kind: BOUNDARY_STATEMENT,
        text: "Tests act on and observe: loans, as members borrow, renew and return books\nEvery test starts from: a library holding no loan",
        why: "This answers what all the module's tests act on and start from: \"Tests act on and observe\" bounds every test, and names no single thing a step returns.",
      },
      {
        kind: WORD_SET,
        text: "Loan status: on time, due today, overdue",
        why: "This answers which words a value can be: a status is one of a fixed list of words a result takes, never a thing a test gets and refers to by name later.",
      },
      {
        kind: OPERATION,
        text: 'Observation "member\'s loans": the loans {member} holds\nInputs: member, Member\nResult: list of Loan',
        why: "This answers what a test can see at the boundary: a phrase with a place {member} and a result type report a value, and the loans it reports are of the entity type Loan.",
      },
      {
        kind: ACCEPTANCE_CRITERION,
        text: "Given a book lent to a member\nThen the member holds a loan of the book",
        why: "This answers which situation and outcome show that a requirement is met: its Given and Then decide a case, and mentioning a loan does not say what a loan is.",
      },
      {
        kind: ABSTRACT_TEST,
        text: test(
          "Verifies AC-03: Given a book lent to a member Then the member holds a loan of the book",
          "",
          'Given (action) add a book titled "Emma", as emma',
          '  and (action) register a member named "Ben", as ben',
          "  and (action) lend emma to ben, as loan",
          "Then (observation) the loans ben holds contains loan",
        ),
        why: "This answers which steps check one criterion: \"as loan\" names a step's result to use it later, which is how a test uses an entity, not a statement of what a loan is.",
      },
    ],
  },
  [WORD_SET]: {
    good: { text: "Loan state: current, overdue, returned" },
    traps: [
      {
        kind: BOUNDARY_STATEMENT,
        text: [
          "Tests act on and observe: loans in each of their states, current, overdue and returned, through what members do and see",
          "Every test starts from: a library holding no member, book or loan",
        ].join("\n"),
        why: "This answers what all the module's tests act on and start from: the states it lists say what tests cover, not the words a value can be.",
      },
      {
        kind: ENTITY_TYPE,
        text: "Genre: A category the library sorts books into, such as poetry or history, which librarians add and rename.",
        why: "This answers which thing a test gets as a step's result: \"which librarians add and rename\" means a test creates a genre and refers to it by name, so it is not one of a fixed list of words.",
      },
      {
        kind: OPERATION,
        text: 'Observation "state of loan": the state of {loan}\nInputs: loan, Loan\nResult: Loan state',
        why: "This answers what a test can see at the boundary: its phrase with a place {loan} reports one loan's state at a step, while the words that state can be are what the set lists.",
      },
      {
        kind: ACCEPTANCE_CRITERION,
        text: "Given a member's loan whose due date has passed\nThen the loan is shown as overdue",
        why: "This answers which situation and outcome show that a requirement is met: its Given and Then decide when one word applies, not which words a value can be.",
      },
      {
        kind: ABSTRACT_TEST,
        text: test(
          "Verifies AC-05: Given a member's loan that is not returned Then the loan is overdue exactly when its due date has passed",
          "",
          'Given (action) add a book titled "Emma", as emma',
          '  and (action) register a member named "Ben", as ben',
          "  and (action) lend emma to ben, as loan",
          "  and (direct setup) let <days> days pass",
          "Then (observation) the state of loan equals <state>",
          "",
          "One test for each row:",
          "days | state",
          "21 | current",
          "22 | overdue",
        ),
        why: "This answers which steps with which values check one criterion: its rows pair concrete inputs with expected words, using the words of a set rather than defining them.",
      },
    ],
  },
  [OPERATION]: {
    good: { text: 'Action "renew loan": renew {loan}\nInputs: loan, Loan\nResult: none\nRefusals: overdue, meaning the loan\'s due date has passed', details: "References AC-01 and AC-02." },
    traps: [
      {
        kind: BOUNDARY_STATEMENT,
        text: [
          "Tests act on and observe: what a member does to renew a loan, and the due date they see afterwards",
          "They leave out: renewals a librarian makes for a member",
          "Every test starts from: a library holding no member, book or loan",
        ].join("\n"),
        why: "This answers what all the module's tests act on, leave out and start from: it bounds every test and gives no phrase, inputs or result a step could call.",
      },
      {
        kind: ENTITY_TYPE,
        text: "Renewal: One extension of a loan's due date, asked for by a member and granted or refused.",
        why: "This answers which thing a test gets as a step's result: it names a renewal and says what it is, and gives nothing a test does.",
      },
      {
        kind: WORD_SET,
        text: "Member action: borrow, renew, return",
        why: "This answers which words a value can be: \"renew\" here is a word a value takes, with no phrase, inputs or result a step could call.",
      },
      {
        kind: ACCEPTANCE_CRITERION,
        text: "Given a member's loan that has been renewed once\nWhen the member renews the loan again\nThen the second renewal is refused",
        why: "This answers which situation, event and outcome show that a requirement is met: renewing is its event, which a test carries out through an operation.",
      },
      {
        kind: ABSTRACT_TEST,
        text: test(
          "Verifies AC-06: Given a book on the library's shelf When a member borrows it Then the member holds one loan",
          "",
          'Given (action) add a book titled "Emma", as emma',
          '  and (action) register a member named "Ben", as ben',
          "When (action) lend emma to ben",
          "Then (observation) the number of loans ben holds equals 1",
        ),
        why: "This answers which steps with which values check one criterion: it strings several operations with concrete values; each line it calls is an operation, the whole is a test.",
      },
      {
        kind: OPERATION,
        text: 'Observation "find books": the books whose title contains {words}\nInputs: words, text\nResult: list of Book',
        why: "The product computes this answer by searching, so finding books is the product's own behaviour under test, an action, not a value reported without computing anything.",
      },
    ],
  },
  [ABSTRACT_TEST]: {
    good: {
      text: test(
        "Verifies AC-01: Given a member's loan that is not overdue When the member renews the loan Then the loan has 21 days left until its due date",
        "",
        'Given (action) add a book titled "Dune", as dune',
        '  and (action) register a member named "Ana", as ana',
        "  and (action) lend dune to ana, as loan",
        "  and (direct setup) let <days> days pass",
        "When (action) renew loan",
        "Then (observation) the days left on loan equals 21",
        "",
        "One test for each row:",
        "days",
        "0",
        "21",
      ),
      details: "Marked: its Given uses a direct setup.",
    },
    traps: [
      {
        kind: ACCEPTANCE_CRITERION,
        text: "Given a member's loan that is due today\nWhen the member renews the loan\nThen the loan has 21 days left until its due date",
        why: "This answers which situation, event and outcome show that a requirement is met: it is written in words with no steps calling the boundary's operations, so it is a criterion, even though \"due today\" names one case precisely.",
      },
      {
        kind: BOUNDARY_STATEMENT,
        text: [
          "Tests act on and observe: the loans of one library and the days left on each",
          "They leave out: fines for late returns",
          "Every test starts from: a library holding no member, book or loan, on its first day",
        ].join("\n"),
        why: "This answers what all the module's tests act on and start from: \"Every test starts from\" holds for all tests at once, while a test builds what it needs in its own Given steps.",
      },
      {
        kind: ENTITY_TYPE,
        text: "Member: A person registered with the library who can borrow its books.",
        why: "This answers which thing a test gets as a step's result: it says what a member, such as the result named ana, is, and calls no operation and checks no criterion.",
      },
      {
        kind: WORD_SET,
        text: "Days to test: 0, 21",
        why: "This answers which words a value can be: its name and list declare the only values an input may take, while the values a test tries are its own concrete values, one row each.",
      },
      {
        kind: OPERATION,
        text: 'Action "renew and check": renew {loan} and report the days left on it\nInputs: loan, Loan\nResult: whole number',
        why: "This answers what a test can do at the boundary: a phrase, a typed input and a result describe one call that checks nothing; a test calls it and compares what it returns.",
      },
    ],
  },
};

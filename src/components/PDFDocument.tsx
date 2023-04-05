import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { observer } from "mobx-react-lite";
import { SnapshotOut } from "mobx-state-tree";
import React from "react";
import { Store } from "store";

interface PDFDocumentProps {
  store: SnapshotOut<Store>;
}

const styles = StyleSheet.create({
  page: {
    padding: 30,
  },
  section: {
    marginBottom: 15,
  },
  title: {
    fontSize: 18,
    marginBottom: 5,
  },
  item: {
    fontSize: 14,
    marginBottom: 3,
  },
  testScenario: {
    marginBottom: 5,
  },
  testCase: {
    marginBottom: 5,
    marginLeft: 10,
  },
});

const PDFDocument: React.FunctionComponent<PDFDocumentProps> = ({ store }) => {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.section}>
          <Text style={styles.title}>Description</Text>
          <Text style={styles.item}>{store.description}</Text>
        </View>
        <View style={styles.section}>
          <Text style={styles.title}>Product Overview</Text>
          <Text style={styles.item}>{store.productOverview}</Text>
        </View>
        <View style={styles.section}>
          <Text style={styles.title}>User Stories</Text>
          {store.userStories.map((story, index) => (
            <Text key={story.id} style={styles.item}>
              {index + 1}. {story.content}
            </Text>
          ))}
        </View>
        <View style={styles.section}>
          <Text style={styles.title}>Requirements</Text>
          {store.requirements.map((req, index) => (
            <Text key={req.id} style={styles.item}>
              {index + 1}. {req.content}
            </Text>
          ))}
        </View>
        <View style={styles.section}>
          <Text style={styles.title}>Acceptance Criteria</Text>
          {store.acceptanceCriteria.map((criteria, index) => (
            <Text key={criteria.id} style={styles.item}>
              {index + 1}. {criteria.content}
            </Text>
          ))}
        </View>
        <View style={styles.section}>
          <Text style={styles.title}>Test Scenarios</Text>
          {store.testScenarios.map((testScenario, index) => (
            <View key={testScenario.id} style={styles.testScenario}>
              <Text>
                Test Scenario {index + 1}: {testScenario.content}
              </Text>
              {testScenario.testCases.map((testCase, testCaseIndex) => (
                <View key={testCase.id} style={styles.testCase}>
                  <Text>
                    Test Case {testCaseIndex + 1}: {testCase.content}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
};

export default observer(PDFDocument);

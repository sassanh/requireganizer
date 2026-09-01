import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { observer } from "mobx-react-lite";
import React from "react";

import { Store } from "store";
import { extractTestCaseCode } from "utilities/testParser";

interface PDFDocumentProps {
  store: Store;
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
          <Text style={styles.title}>Name</Text>
          <Text style={styles.item}>{store.productOverview.name}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.title}>Purpose</Text>
          <Text style={styles.item}>{store.productOverview.purpose}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.title}>Primary Features</Text>
          {store.productOverview.primaryFeatures.map(
            (primaryFeature, index) => (
              <Text key={index} style={styles.item}>
                - {primaryFeature.content}
              </Text>
            ),
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.title}>Target Users</Text>
          {store.productOverview.targetUsers.map((targetUser, index) => (
            <Text key={index} style={styles.item}>
              - {targetUser.content}
            </Text>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.title}>Implementation Profile</Text>
          <Text style={styles.item}>
            {store.implementationProfile == null
              ? "Not approved"
              : `${store.implementationProfile.language} - ${store.implementationProfile.framework}`}
          </Text>
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
              {testScenario.testCases.map((testCase, testCaseIndex) => {
                const testCaseCode = extractTestCaseCode(
                  Array.from(store.scaffoldFiles),
                  testScenario.id,
                  testCase.id,
                  store.implementationProfile?.language || "typescript"
                );

                return (
                  <View key={testCase.id} style={styles.testCase}>
                    <Text>
                      Test Case {testCaseIndex + 1}: {testCase.title}
                    </Text>
                    <Text style={{ fontSize: 12, marginLeft: 10, marginTop: 2 }}>
                      Steps: {testCase.steps}
                    </Text>
                    <Text style={{ fontSize: 12, marginLeft: 10, marginTop: 2, fontStyle: 'italic' }}>
                      Expected: {testCase.expectedResult}
                    </Text>
                    {testCaseCode && (
                      <View style={{ marginTop: 5, padding: 5, backgroundColor: '#f5f5f5' }}>
                        <Text style={{ fontSize: 10, fontFamily: 'Courier' }}>
                          {testCaseCode}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
};

export default observer(PDFDocument);
